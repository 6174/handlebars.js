// BEGIN(BROWSER)

(function(Handlebars) {

var dom = 'dom';

Handlebars.htmlHelpers = {};

Handlebars.registerHTMLHelper = function(name, callback) {
  Handlebars.htmlHelpers[name] = callback;
};

Handlebars.compileHTML = function(string, options) {
  var ast = Handlebars.preprocessHTML(string),
      compiler1 = new Handlebars.HTMLCompiler1(options),
      compiler2 = new Handlebars.HTMLCompiler2(options);

  var opcodes = compiler1.compile(ast);
  return compiler2.compile(opcodes);
};

function merge(options, defaults) {
  for (var prop in defaults) {
    if (options.hasOwnProperty(prop)) { continue; }
    options[prop] = defaults[prop];
  }
}

Handlebars.HTMLCompiler1 = function(options) {
  this.options = options || {};

  var knownHelpers = {
    'helperMissing': true,
    'blockHelperMissing': true,
    'each': true,
    'if': true,
    'unless': true,
    'with': true,
    'log': true
  };

  this.options.knownHelpers = this.options.knownHelpers || {};
  merge(knownHelpers, this.options.knownHelpers);
};

var compiler1 = Handlebars.HTMLCompiler1.prototype;

compiler1.compile = function(ast) {
  this.opcodes = [];
  processChildren(this, ast);
  return this.opcodes;
};

function processChildren(compiler, children) {
  var node;

  for (var i=0, l=children.length; i<l; i++) {
    node = children[i];

    if (typeof node === 'string') {
      compiler.string(node);
    } else if (node instanceof Handlebars.HTMLElement) {
      compiler.element(node);
    } else if (node instanceof Handlebars.BlockElement) {

    } else {
      compiler[node.type + "Content"](node);
    }
  }
}

compiler1.opcode = function(type) {
  var params = [].slice.call(arguments, 1);
  this.opcodes.push({ type: type, params: params });
};

compiler1.string = function(string) {
  this.opcode('content', string);
};

compiler1.element = function(element) {
  this.opcode('openElement', element.tag);

  element.attributes.forEach(function(attribute) {
    this.attribute(attribute);
  }, this);

  processChildren(this, element.children);

  this.opcode('closeElement');
};

compiler1.attribute = function(attribute) {
  var name = attribute[0],
      value = attribute[1];

  if (value.length > 1) {
    throw new Error("unimplemented");
  }

  value = value[0];

  if (typeof value === 'string') {
    this.opcode('attribute', name, value);
  } else {
    this[value.type + "Attr"](name, value);
  }
};

compiler1.mustacheAttr = function(attrName, mustache) {
  var type = classifyMustache(mustache, this.options);

  if (type === 'simple') {
    this.opcode('dynamicAttr', attrName, mustache.id.parts, mustache.escaped);
  } else if (type === 'ambiguous') {
    this.opcode('ambiguousAttr', attrName, mustache.id.string, mustache.escaped);
  } else {
    processParams(this, mustache.params);
    this.opcode('helperAttr', attrName, mustache.id.string, mustache.params.length);
  }

  applyAttribute(this, attrName, mustache);
};

compiler1.mustacheContent = function(mustache) {
  var type = classifyMustache(mustache, this.options);

  if (type === 'simple') {
    this.opcode('dynamic', mustache.id.parts, mustache.escaped);
  } else if (type === 'ambiguous') {
    this.opcode('ambiguous', mustache.id.string, mustache.escaped);
  } else {
    processParams(this, mustache.params);
    this.opcode('helper', mustache.id.string, mustache.params.length, mustache.escaped);
  }

  appendMustache(this, mustache);
};

compiler1.ID = function(id) {
  this.opcode('id', id.parts);
};

compiler1.STRING = function(string) {
  this.opcode('string', string.stringModeValue);
};

compiler1.BOOLEAN = function(boolean) {
  this.opcode('literal', boolean.stringModeValue);
};

compiler1.INTEGER = function(integer) {
  this.opcode('literal', integer.stringModeValue);
}

function classifyMustache(mustache, options) {
  var isHelper   = mustache.isHelper;
  var isEligible = mustache.eligibleHelper;

  // if ambiguous, we can possibly resolve the ambiguity now
  if (isEligible && !isHelper) {
    var name = mustache.id.parts[0];

    if (options.knownHelpers[name]) {
      isHelper = true;
    } else if (options.knownHelpersOnly) {
      isEligible = false;
    }
  }

  if (isHelper) { return "helper"; }
  else if (isEligible) { return "ambiguous"; }
  else { return "simple"; }
}

function processParams(compiler, params) {
  params.forEach(function(param) {
    compiler[param.type](param);
  });
}

function appendMustache(compiler, mustache) {
  if (mustache.escaped) {
    compiler.opcode('appendText');
  } else {
    compiler.opcode('appendFragment');
  }
}

function applyAttribute(compiler, attrName, mustache) {
  if (mustache.escaped) {
    compiler.opcode('applyAttribute', attrName);
  } else {
    throw new Error("Unescaped attributes are not allowed");    
  }
}

Handlebars.HTMLCompiler2 = function() {};

var compiler2 = Handlebars.HTMLCompiler2.prototype;

compiler2.compile = function(opcodes) {
  this.output = [];
  this.elementNumber = 0;
  this.stackNumber = 0;
  this.stack = [];

  this.preamble();
  processOpcodes(this, opcodes);
  this.postamble();

  console.debug(this.output.join("\n"));

  return new Function('context', this.output.join("\n"));
};

function processOpcodes(compiler, opcodes) {
  opcodes.forEach(function(opcode) {
    compiler[opcode.type].apply(compiler, opcode.params);
  });
}

compiler2.preamble = function() {
  this.push("var element0, el");
  this.push("var frag = element0 = document.createDocumentFragment()");
  this.push("var dom = Handlebars.dom")
};

compiler2.postamble = function() {
  this.output.push("return frag;");
};

compiler2.content = function(string) {
  this.push(invoke(this.el(), 'appendChild', helper('frag', this.el(), quotedString(string))));
};

compiler2.push = function(string) {
  this.output.push(string + ";");
};

compiler2.el = function() {
  return topElement(this);
};

compiler2.id = function(parts) {
  pushStackLiteral(this, quotedString('id'));
  pushStackLiteral(this, quotedArray(parts));
};

compiler2.literal = function(literal) {
  pushStackLiteral(this, quotedString(typeof literal));
  pushStackLiteral(this, literal);
};

compiler2.string = function(string) {
  pushStackLiteral(this, quotedString('string'));
  pushStackLiteral(this, quotedString(string));
};

compiler2.appendText = function() {
  this.push(helper('appendText', this.el(), popStack(this)));
};

compiler2.appendFragment = function() {
  this.push(helper('appendFragment', this.el(), popStack(this)));
};

compiler2.openElement = function(tagName) {
  var elRef = pushElement(this);
  this.push("var " + elRef + " = el = " + invoke('document', 'createElement', quotedString(tagName)));
};

compiler2.attribute = function(name, value) {
  this.push(invoke('el', 'setAttribute', quotedString(name), quotedString(value)));
};

compiler2.closeElement = function() {
  var elRef = popElement(this);
  this.push(invoke(this.el(), 'appendChild', elRef));
};

compiler2.dynamic = function(parts, escaped) {
  pushStackLiteral(this, helper('resolveContents', 'context', quotedArray(parts), this.el(), escaped));
};

compiler2.ambiguous = function(string, escaped) {
  pushStackLiteral(this, helper('ambiguousContents', this.el(), 'context', quotedString(string), escaped));
};

compiler2.helper = function(name, size, escaped) {
  var prepared = prepareHelper(this, size);
  pushStackLiteral(this, helper('helperContents', quotedString(name), this.el(), 'context', prepared.args, prepared.options));
};

compiler2.dynamicAttr = function(attrName, parts) {
  pushStackLiteral(this, helper('resolveAttr', 'context', quotedArray(parts), this.el(), quotedString(attrName)));
};

compiler2.ambiguousAttr = function(attrName, string) {
  pushStackLiteral(this, helper('ambiguousAttr', this.el(), 'context', quotedString(attrName), quotedString(string)));
};

compiler2.helperAttr = function(attrName, name, size) {
  var prepared = prepareHelper(this, size);
  pushStackLiteral(this, helper('helperAttr', quotedString(name), this.el(), quotedString(attrName), 'context', prepared.args, prepared.options));
};

function prepareHelper(compiler, size) {
  var args = [],
      types = [];

  for (var i=0; i<size; i++) {
    args.push(popStack(compiler));
    types.push(popStack(compiler));
  }

  return {
    options: '{types:' + array(types) + '}',
    args: array(args),
  };
}

compiler2.applyAttribute = function(attrName) {
  this.push(helper('applyAttribute', this.el(), quotedString(attrName), popStack(this)));
};

function invoke(receiver, method) {
  var params = [].slice.call(arguments, 2);
  return receiver + "." + method + "(" + params.join(", ") + ")";
}

function helper() {
  var args = [].slice.call(arguments, 0);
  args.unshift(dom);
  return invoke.apply(this, args);
}

function escapeString(string) {
  return string.replace(/'/g, "\\'");
}

function quotedString(string) {
  return "'" + escapeString(string) + "'";
}

function quotedArray(list) {
  return array(list.map(quotedString).join(", "));
}

function array(array) {
  return "[" + array + "]";
}

function pushElement(compiler) {
  return "element" + (++compiler.elementNumber);
}

function popElement(compiler) {
  return "element" + (compiler.elementNumber--);
}

function topElement(compiler) {
  return "element" + compiler.elementNumber;
}

function pushStack(compiler) {
  var stack = compiler.stack,
      stackNumber = "stack" + (++compiler.stackNumber);

  stack.push({ literal: false, value: stackNumber });
}

function pushStackLiteral(compiler, literal) {
  compiler.stack.push({ literal: true, value: literal });
}

function popStack(compiler) {
  var stack = compiler.stack,
      poppedValue = stack.pop();

  if (!poppedValue.literal) {
    stackNumber--;
  }
  return poppedValue.value;
}

function topStack(compiler) {
  var stack = compiler.stack;

  return stack[stack.length - 1].value;
}

// These methods are runtime for now. If they are too expensive,
// I may inline them at compile-time.
Handlebars.dom = {
  appendText: function(element, value) {
    if (value === undefined) { return; }
    element.appendChild(document.createTextNode(value));
  },

  appendFragment: function(element, value) {
    if (value === undefined) { return; }
    element.appendChild(this.frag(element, value));
  },

  ambiguousContents: function(element, context, string, escaped) {
    var helper, value, args;

    if (helper = Handlebars.htmlHelpers[string]) {
      return this.helperContents(string, element, context, [], { element: element, escaped: escaped });
    } else {
      return this.resolveContents(context, [string], element, escaped);
    }
  },

  helperContents: function(name, element, context, args, options) {
    var helper = Handlebars.htmlHelpers[name];
    options.element = element;
    args.push(options);
    return helper.apply(context, args);
  },

  resolveContents: function(context, parts, element, escaped) {
    var helper = Handlebars.htmlHelpers.RESOLVE;
    if (helper) {
      return helper.apply(context, [parts, { element: element, escaped: escaped }]);
    }

    return parts.reduce(function(current, part) {
      return current[part];
    }, context)
  },

  ambiguousAttr: function(element, context, attrName, string) {
    var helper, value, args;

    if (helper = Handlebars.htmlHelpers[string]) {
      throw new Error("helperAttr is not implemented yet");
    } else {
      return this.resolveAttr(context, [string], element, attrName)
    }
  },

  helperAttr: function(name, element, attrName, context, args, options) {
    var helper = Handlebars.htmlHelpers[name];
    options.element = element;
    options.attrName = attrName;
    args.push(options);
    return helper.apply(context, args);
  },

  applyAttribute: function(element, attrName, value) {
    if (value === undefined) { return; }
    element.setAttribute(attrName, value);
  },

  resolveAttr: function(context, parts, element, attrName, escaped) {
    var helper = Handlebars.htmlHelpers.RESOLVE_ATTR;

    if (helper) {
      return helper.apply(context, [parts, { element: element, attrName: attrName }]);
    }

    return parts.reduce(function(current, part) {
      return current[part];
    }, context)
  },

  frag: function(element, string) {
    /*global DocumentFragment*/
    if (element instanceof DocumentFragment) {
      element = document.createElement('div');
    }

    var range = document.createRange();
    range.setStart(element);
    range.collapse(false);
    return range.createContextualFragment(string);
  }
};

})(Handlebars);

// END(BROWSER)