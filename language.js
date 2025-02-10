//extra runtime stuff
class Pointer {
    constructor(get, set) {
        this.get = get;
        this.set = set;
    }
    get deref() {
        return this.get();
    }
    set deref(v) {
        return this.set(v);
    }
}

Symbol.display = Symbol("display");

window.console = new Proxy(
    window.console,
    {
        get(t, prop) {
            return (...args) => {
                const a = args.map((v) => {
                    if(v[Symbol.display]) {
                        return v[Symbol.display]();
                    } else {
                        return v.toString();
                    }
                });
                t[prop](...a);
            };
        },
    }
);

//language
(() => {
    //language
    const macros = new Map();
    const alias = new Map();

    const types = acorn.tokTypes;
    types.alias = (() => {
        const t = JSON.parse(JSON.stringify(types.name));
        t.label = "alias";
        return t;
    })();

    types.macro = (() => {
        const t = JSON.parse(JSON.stringify(types.name));
        t.label = "macro";
        return t;
    })();

    types.decorator = (() => {
        const t = JSON.parse(JSON.stringify(types.name));
        t.label = "decorator";
        return t;
    })();

    function Macros(Parser) {
        return class extends Parser {
            constructor(...args) {
                super(...args);
            }
            getTokenFromCode(c) {
                if (String.fromCharCode(c) === "@") {
                    this.pos++;
                    return this.finishToken(types.decorator);
                }
                super.getTokenFromCode(c);
            }
            nextToken() {
                super.nextToken();
                if (alias.has(this.value)) {
                    const { value, type } = alias.get(this.value);
                    this.value = value;
                    this.type = type;
                }
                if (this.value === "alias") {
                    this.type = types.alias;
                }
                if (this.value === "macro") {
                    this.type = types.macro;
                }
            }
            parseMacroArgs() {
                let startPos = this.start;
                const l = types.parenL;
                const r = types.parenR;
                this.expect(l);
                const args = [];
                let depth = 1;
                while (depth > 0) {
                    if (this.type === l) {
                        depth++;
                    } else if (this.type === r) {
                        depth--;
                    } else if (this.type === types.eof) {
                        this.unexpected();
                    } else if (this.type === types.comma) {
                        if (depth === 1) {
                            const endPos = this.start + 1;
                            const content = this.input
                                .slice(startPos, endPos)
                                .trim()
                                .slice(1, -1)
                                .trim();
                            args.push(content);
                            startPos = this.start;
                        }
                    }
                    this.next();
                }
                const endPos = this.start;
                const content = this.input
                    .slice(startPos, endPos)
                    .trim()
                    .slice(1, -1)
                    .trim();
                args.push(content);
                startPos = this.start;
                return args.map((v) => v.trim()).filter((v) => v !== "");
            }
            toAssignable(t, e, i) {
                if (t.type === "MacroInvocation") {
                    return t;
                }
                return super.toAssignable(t, e, i);
            }
            checkLValSimple(t, e, i) {
                if (t.type === "MacroInvocation") {
                    return t;
                }
                return super.checkLValSimple(t, e, i);
            }
            parseBalancedBraces() {
                const startPos = this.start;
                this.expect(types.braceL);

                let braceDepth = 1;
                while (braceDepth > 0) {
                    if (this.type === types.braceL) {
                        braceDepth++;
                    } else if (this.type === types.braceR) {
                        braceDepth--;
                    } else if (this.type == types.eof) {
                        this.unexpected();
                    }

                    this.next();
                }

                const endPos = this.start;
                const content = this.input
                    .slice(startPos, endPos)
                    .trim()
                    .slice(1, -1)
                    .trim();

                return content;
            }
            parseDecorator(dname, type) {
                switch (type.type) {
                    case "ClassDeclaration": {
                        const name = type.id.name;
                        let raw = astring.generate(type, {
                            generator: GENERATOR,
                        });
                        raw = raw.trim().endsWith(";")
                        ? raw.trim().slice(0, -1)
                        : raw.trim();
                        const node = this.startNode();
                        node.rawCode = `const ${name} = ${dname}(${raw}, "class");`;
                        return this.finishNode(node, "MacroInvocation");
                    }
                    case "FunctionDeclaration": {
                        const fname = type.id.name;
                        let fnraw = astring.generate(type, {
                            generator: GENERATOR,
                        });
                        fnraw = fnraw.trim().endsWith(";")
                        ? fnraw.trim().slice(0, -1)
                        : fnraw.trim();
                        const node = this.startNode();
                        node.rawCode = `const ${fname} = ${dname}(${fnraw}, "function");`;
                        return this.finishNode(node, "MacroInvocation");
                    }
                    default:
                        this.raise(this.pos, `unexpected type "${type.type}"`)
                }
            }
            parseStatement() {
                if (this.type === types.decorator) {
                    this.next();
                    let dname = this.parseExprAtom().name;
                    if(this.type === types.parenL) {
                        dname += `(${this.parseMacroArgs().join(", ")})`;
                    }
                    const type = this.parseStatement();
                    return this.parseDecorator(dname, type);
                }
                if (this.type === types.macro) {
                    this.next();
                    if (this.value !== "!") {
                        this.raise(this.pos, "you need to add '!' in order to use 'macro'");
                    }
                    this.next();
                    const name = this.parseIdent().name;
                    const _node = {};
                    this.parseFunctionParams(_node);
                    _node.params = _node.params.map((v) => v.name);
                    _node.body = this.parseBalancedBraces();
                    macros.set(name, _node);
                    const literal = this.startNode();
                    literal.value = `'defined macro "${name}"'`;
                    literal.raw = literal.value;
                    const node = this.startNode();
                    node.expression = this.finishNode(literal, "Literal");
                    return this.finishNode(node, "ExpressionStatement");
                }
                if (this.type === types.alias) {
                    this.next();
                    if (this.value !== "!") {
                        this.raise(this.pos, "you need to add '!' in order to use 'alias'");
                    }
                    this.next();
                    const name = this.value;
                    if (this.value === undefined) {
                        this.raise(this.pos, "invalid alias name");
                    }
                    if (this.type !== types.name) {
                        if (this.type === types.num) {
                            this.raise(this.pos, "invalid alias name");
                        }
                        console.warn(
                            "It is not recomended to use a non-ident name for an alias"
                        );
                    }
                    this.next();
                    if (this.value !== "=") {
                        this.raise(this.pos, "expect '='");
                    }
                    this.next();
                    alias.set(name, {
                        value: this.value,
                        type: this.type,
                    });
                    this.next();
                    const literal = this.startNode();
                    literal.value = `'defined alias "${name}"'`;
                    literal.raw = literal.value;
                    const node = this.startNode();
                    node.expression = this.finishNode(literal, "Literal");
                    return this.finishNode(node, "ExpressionStatement");
                }
                return super.parseStatement();
            }
            getName(str) {
                if (!str.includes("v")) {
                    return "v";
                }
                if (!str.includes("_v")) {
                    return "_v";
                }
                if (!str.includes("v_")) {
                    return "v_";
                }
                if (!str.includes("_v_")) {
                    return "_v_";
                }
                let i = 0;
                while (str.includes("_v_" + i)) {
                    i++;
                }
                return "_v_" + i;
            }
            parseExprAtom() {
                if (this.type === types.bitwiseAND) {
                    this.next();
                    const ast = this.parseExprAtom();
                    const code = astring.generate(ast, {
                        generator: GENERATOR,
                    });
                    const v = code.endsWith(";") ? code.trim().slice(0, -1) : code.trim();
                    const node = this.startNode();
                    const n = this.getName(v);
                    node.rawCode = `(new Pointer(() => ${v}, ${n} => (${v}) = ${n}))`;
                    return this.finishNode(node, "MacroInvocation");
                }
                if (this.type === types.star) {
                    this.next();
                    const ast = this.parseExprAtom();
                    const code = astring.generate(ast, {
                        generator: GENERATOR,
                    });
                    const v = code.endsWith(";") ? code.trim().slice(0, -1) : code.trim();
                    const node = this.startNode();
                    node.rawCode = `(${v}).deref`;
                    return this.finishNode(node, "MacroInvocation");
                }
                if (macros.has(this.value)) {
                    const name = this.value;
                    const macro = macros.get(name);
                    this.next();
                    if (this.value !== "!") {
                        const node = this.startNode();
                        node.name = name;
                        return this.finishNode(node, "Identifier");
                    }
                    this.next();
                    const args = this.parseMacroArgs();
                    if (args.length !== macro.params.length) {
                        this.raise(
                            this.pos,
                            `macro "${name}" expected ${macro.params.length} ${
                                macro.params.length === 1 ? "arg" : "args"
                            }, ${args.length} were provided`
                        );
                    }
                    let n = macro.body;
                    for (const [i, param] of Object.entries(macro.params)) {
                        const arg = args[i];
                        n = n.replaceAll(new RegExp("(?<!\\\\)\\$" + param, "gm"), arg);
                    }
                    n = n.replaceAll(/\\$/gm, "$");
                    const node = this.startNode();
                    node.rawCode = n;
                    return this.finishNode(node, "MacroInvocation");
                }
                return super.parseExprAtom();
            }
        };
    }

    const macroParser = acorn.Parser.extend(Macros);

    const GENERATOR = Object.assign({}, astring.GENERATOR, {
        MacroInvocation: function (node, state) {
            const ast = macroParser.parse(node.rawCode, {
                ecmaVersion: "latest",
                allowAwaitOutsideFunction: true,
            });
            const code = astring.generate(ast, {
                generator: GENERATOR,
            });
            state.write(
                code.trim().endsWith(";") ? code.trim().slice(0, -1) : code.trim()
            );
        },
    });

    function compile(str) {
        if (str === '{"message":"Asset does not exist"}') {
            throw new Error("asset does not exist");
        }
        const ast = macroParser.parse(str, {
            ecmaVersion: "latest",
        });

        const code = astring.generate(ast, {
            generator: GENERATOR,
        });
        return code;
    }

    (async () => {
        const doc = $.doc();
        const jspp = doc.all('script[type="js++"]');
        for (const code of jspp) {
            if (code.getProp("src")) {
                try {
                    const js = await (
                        await fetch(code.getProp("src") + "?cache=" + Date.now())
                    ).text();
                    code.elt.removeAttribute("src");
                    code.text(compile(js));
                } catch (e) {
                    if (e.message !== "asset does not exist") {
                        console.error(e);
                    }
                    code.elt.removeAttribute("src");
                    code.text(compile(code.text()));
                }
            } else {
                code.text(compile(code.text()));
            }
            code.elt.removeAttribute("type");
        }
    })();
})()

