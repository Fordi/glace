(function () {
  let GlaceFactory = (PARSER) => {
    const NIL = () => {};
    const NOP = () => ({ output: [], update: NIL });
    const CONTENT_TYPE = 'text/glace-template';
    const { keys, assign } = Object;
    const PARSERERROR = 'parsererror';
    const YIELD = '_yieldedTemplate_';
    const { isArray } = Array;
    const each = [].forEach;
    // Must be written in minified ES5 for compatibility and size
    // `state` must not be mangled, as it's used internally
    const GETTER_FN = `return function(state){try{with(state){return($)}}catch(e){return undefined}}`;
    const mockDoc = PARSER.parseFromString('<html><head></head><body></body></html>', 'text/html');
    const SANITIZER = mockDoc.createElement('div');
    // For the Node.NODE_* constants
    const Node = {
      ELEMENT_NODE: 1,
      ATTRIBUTE_NODE: 2,
      TEXT_NODE: 3,
      CDATA_SECTION_NODE: 4,
      COMMENT_NODE: 8,
      DOCUMENT_NODE: 9
    };

    let TEMPLATES = {};
    let exports = (name) => {
      return TEMPLATES[name];
    };
    /**
     * Macro for inserting a DOM node before another node.
     */
    let before = (child, ref) => {
      ref.parentNode.insertBefore(child, ref);
    };
    /**
     * Macro for removing a DOM node.
     */
    let remove = (child) => {
      child.parentNode.removeChild(child);
    };
    /**
     * Turns a `<parsererror>` node into an Error-like object
     */
    function TemplateError(node, filename) {
      let name = 'TemplateError';
      let error = {};
      let line = undefined;
      let col = undefined;
      let msg = undefined;
      node.textContent.replace(/ line (\d+?)| column (\d+?)|: (.*?)$/gm, (_, _line_, _col_, _msg_) => {
        line = line || _line_;
        col = col || _col_;
        msg = msg || _msg_;
      });
      assign(this, {
        message: msg,
        name: name,
        file: filename,
        line: line,
        column: col,
        stack: `${name} ${msg}\n\tat ${this.file || '<anonymous>'}:${line}:${col}`
      });
    }

    /**
     * HTML escapes a string
     */
    let sanitize = (str) => {
      SANITIZER.textContent = str;
      return SANITIZER.innerHTML;
    };

    // Not necessary, but nice.
    // TemplateError.prototype = Object.create(Error.prototype);
    // TemplateError.prototype.constructor = TemplateError;

    /**
     * Gives a node a document fragment as a parentNode, so that
     *  DOM operations can be performed on it as a sibling
     */
    let fragParent = (node) => {
      let f = node.ownerDocument.createDocumentFragment();
      f.appendChild(node);
      return node;
    };
    /**
     * Creates a Marker - an empty text node with a parent that can be used
     *  to keep track of a View's contents.
     */
    let newMarker = doc => fragParent(doc.createTextNode(''));
    /**
     * Append a template to a DOM element, given a state,
     *  optionally with a dispatcher
     * If the state is a Redux-like store (supporting #getState and #dispatch),
     *  will automatically subscribe to the store.
     **/
    let append = (parentNode, childTemplate, state, dispatch) => {
      if (typeof childTemplate === 'string') {
        childTemplate = exports(childTemplate);
      }
      let doc = parentNode.ownerDocument;
      let store = null;
      if (state && state.getState && state.subscribe) {
        // This is a redux-like store; handle it autmatically
        store = state;
        dispatch = store.dispatch;
        state = store.getState();
      }
      let rendered = childTemplate(doc, state, dispatch);
      rendered.output.forEach((child) => {
        parentNode.appendChild(child);
      });
      if (store) {
        let stale = false;
        store.subscribe(() => {
          if (!stale) {
            stale = true;
            requestAnimationFrame(_ => {
              rendered.update(store.getState());
              stale = false;
            });
          }
        });
      }
      return rendered.update;
    };
    /**
     * Returns a template function that behaves like an `if` statement.
     *  The limitations of XML markup mean that we can't have an `else`
     *  clause.
     */
    let condition = (trueTemplate, falseTemplate, condition) => {
      trueTemplate = trueTemplate || NOP;
      falseTemplate = falseTemplate || NOP;
      let getCondition = getter(condition);
      return (doc, state, dispatch) => {
        let ins = NOP();
        let marker = newMarker(doc);
        let value = undefined;
        let update = newState => {
          // Object's removed, but updater's being called;
          //  return to init state
          if (!marker.parentNode) {
            ins = NOP();
            value = undefined;
            return;
          }
          let newValue = !!getCondition(newState);
          if (newValue !== value) {
            value = newValue;
            ins.output.forEach(node => remove(node));
            ins = newValue ?
              trueTemplate(doc, newState, dispatch) :
              falseTemplate(doc, newState, dispatch);
            ins.output.forEach(node => before(node, marker));
          } else {
            ins.update(newState);
          }
        };
        update(state);
        return {
          output: [].slice.call(marker.parentNode.childNodes),
          update
        }
      };
    };
    /**
     * Returns a template function that inlines another template
     *  based on `expression`, with an inner template that can be
     *  further transcluded using <yield />
     */
    let transclude = (yieldTemplate, template, state) => {
      let getTemplate = getter(template);
      let getChildState = state ? getter(state) : ((newState) => newState);
      let adjustState = (state) => {
        let localState = assign({}, state);
        localState[YIELD] = yieldTemplate;
        return localState;
      };
      return (doc, state, dispatch) => {
        let marker = newMarker(doc);
        let template = undefined;
        let ins = { output: [], update: () => {} };
        let update = newState => {
          newState = adjustState(getChildState(newState));
          let newTemplate = getTemplate(newState) || NOP;
          if (newTemplate !== template) {
            template = newTemplate;
            if (typeof template === 'string') {
              template = exports(template);
            }
            ins.output.forEach(child => remove(child));
            ins = template(doc, newState, dispatch);
            ins.output.forEach(child => before(child, marker));
          } else {
            ins.update(newState);
          }
        };
        update(state);
        return {
          output: [].slice.call(ins.output).concat([marker]),
          update
        };
      };
    };
    /**
     * Returns a template that renders a list, using an instance of
     *  `templateForEach` for each item.
     * Default names for the content item and index are `content` and
     *  `index`, but can be overridden in the <for> helper using the
     *  attributes `as` and `index`
     */
    let list = (templateForEach, expression, asName, indexName) => {
      let getList = getter(expression);
      let list = [];
      let ins = [];
      asName = asName || 'content';
      indexName = indexName || 'index';
      let makeState = (newState, index, value) => {
        let obj = { parent: newState };
        obj[asName] = value;
        obj[indexName] = index;
        return obj;
      };
      return (doc, state, dispatch) => {
        let marker = newMarker(doc);
        let update = newState => {
          if (!marker.parentNode) {
            list = [];
            ins = [];
            return;
          }
          let newList;
          newList = getList(newState) || [];
          let len = Math.max(list.length, newList.length);
          let parentNode = marker.parentNode;
          for (let i = 0; i < len; i += 1) {
            let cpos = (ins[i+1] && ins[i+1].output[0]) || marker;
            // Present in both places
            if (list[i] && newList[i]) {
              if (list[i] !== newList[i]) {
                ins[i].update(makeState(newState, i, newList[i]));
              }
            } else if (list[i] && !newList[i]) {
              ins[i].output.forEach(child => remove(child));
              ins[i] = null;
            } else if (!list[i] && newList[i]) {
              ins[i] = templateForEach(doc, makeState(newState, i, newList[i]), dispatch);
              ins[i].output.forEach(child => before(child, cpos));
            }
          }
          ins.length = newList.length;
          list = newList;
        };
        update(state);
        return {
          output: [].slice.call(marker.parentNode.childNodes),
          update
        };
      }
    };

    /**
     * Tokenizer for template literals.  These are JS-style, e.g.,
     *  `text text text ${expression} text text text`.
     * Result is an array of strings, where the even members are
     *  raw text and the odd members are expressions
     */
    let tokenizeLiterals = s => {
      let tokens = [];
      let state;
      let cur = [];
      let depth = 0;
      state = 0;
      for (let i = 0; i < s.length; i += 1) {
        if (s[i] === '\\' && s[i+1] === '$' ||s[i+1] === '\\') {
          cur.push(s[i+1]);
          i += 1;
          continue;
        }
        if (state === 0) {
          if (s[i] === '$' && s[i+1] === '{') {
            state = 1;
            i += 1;
            depth = 1;
            tokens.push(cur.join(''));
            cur = [];
            continue;
          }
        }
        if (state === 1) {
          if (s[i] === '{') {
            depth += 1;
            cur.push(s[i]);
            continue;
          }
          if (s[i] === '}') {
            depth -= 1;
            if (depth === 0) {
              state = 0;
              tokens.push(cur.join(''));
              cur = [];
              continue;
            }
          }
        }
        cur.push(s[i]);
      }
      if (state === 1) {
        throw new Error("Unclosed template literal: " + s);
      }
      if (cur.length) {
        tokens.push(cur.join(''));
      }
      return tokens;
    };

    /**
     * Creates a sandboxed getter function for a property described by
     *  `expression`.  The getter function accepts the `state` as its
     *  argument.
     *  The expression has access to a set of injected methods; at the moment,
     *  that set is just `sanitize`.
     */
    let getter = (expression) => {
      let body = GETTER_FN.replace(/\$/g, expression);
      let fn = new Function(
        // List of injected keywords
        'sanitize',
      body)(
        // list of injected values
        sanitize
      );
      fn.expression = expression;
      return fn;
    };
    /**
     * Return a template that is the concatenation of a number of templates
     */
    let concatenate = templates => {
      templates = templates.map((tpl) => {
        if (typeof tpl === 'string') {
          return compile(tpl);
        }
        if (isArray(tpl)) {
          return concatenate(tpl);
        }
        return tpl;
      });
      return (d, s, dispatch) => {
        let nodes = [];
        let updaters = [];
        templates.forEach(template => {
          let handle = template(d, s, dispatch);
          nodes = nodes.concat(handle.output);
          updaters.push(handle.update);
        });
        return {
          output: nodes,
          update: newState => {
            updaters.forEach(updater => updater(newState));
          }
        };
      };
    };

    /**
     * Create an array of template functions from a DOM tree.  This is the
     *  meat of `compile`
     */
    let makeDOMGenerators = (nodes, filename) => {
      let generators = [];
      nodes.forEach((node) => {
        // Ignored (normally because should never see)
        //  COMMENT_NODE <- intentionally ignored
        //  PROCESSING_INSTRUCTION_NODE <- intentionally ignored
        //  CDATA_SECTION_NODE <- should handle these
        //  DOCUMENT_NODE
        //  DOCUMENT_FRAGMENT_NODE
        //  DOCUMENT_TYPE_NODE
        //  ENTITY_NODE
        //  ENTITY_REFERENCE_NODE
        //  NOTATION_NODE
        //  ATTRIBUTE_NODE
        if (node.nodeType === Node.TEXT_NODE) {
          return tokenizeLiterals(node.textContent).forEach((t, i) => {
            let isText = (i % 2) === 0;
            if (!t) { return; }
            if (isText) {
              generators.push((d, s) => {
                return {
                  output: [d.createTextNode(t)],
                  update: NIL
                };
              });
            } else {
              let getValue = getter(t);
              generators.push((d, s) => {
                let n = d.createTextNode(getValue(s));
                return {
                  output: [n],
                  update: (newState) => {
                    n.textContent = getValue(newState);
                  }
                }
              });
            }
          });
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
          let tagName = node.tagName;
          let lcTag = tagName.toLowerCase();
          if (exports.tagHandlers[lcTag]) {
            generators.push(callTagHandler(lcTag, node));
            return;
          }
          let childGenerators = makeDOMGenerators([].slice.call(node.childNodes));
          let attributes = [];
          let events = [];
          each.call(node.attributes, att => {
            if (att.nodeName.substr(0, 3) === 'on-') {
              events.push({
                name: att.nodeName.substr(3),
                action: new Function('event', 'state', 'dispatch', 'with(state){\n' + att.nodeValue + '\n}')
              });
            } else {
              attributes.push({
                name: att.nodeName,
                value: tokenizeLiterals(att.nodeValue).map((att, i) => {
                  if ((i % 2) === 0) {
                    return att;
                  } else {
                    return getter(att);
                  }
                })
              });
            }
          });
          generators.push((d, s, dispatch) => {
            let el = d.createElement(tagName);
            events.forEach(handler => {
              el.addEventListener(handler.name, (event) => {
                return handler.action.call(event.target, event, currentState, dispatch);
              }, false);
            });

            let updaters = [];
            childGenerators.forEach(gen => {
              let child = gen(d, s, dispatch);
              updaters.push(child.update);
              child.output.forEach(childNode => {
                el.appendChild(childNode);
              });
            });
            let currentState = s;
            let update = newState => {
              currentState = newState
              attributes.forEach(att => {
                if (attributeHandlers[att.name]) {
                  attributeHandlers[att.name](newState, el, att.value);
                } else {
                  el.setAttribute(att.name, att.value.map(token => {
                  if (token instanceof Function) {
                    return token(newState);
                  } else {
                    return token;
                  }
                }).join(''));
                }
              });
              updaters.forEach(updater => updater(newState));
            };
            update(s);
            return {
              output: [el],
              update
            };
          });
        }
      });
      return generators;
    };
    /**
     * Shorthand for concatenate(makeDOMGenerators(...))
     */
    let encapsulate = nodeList => {
      return concatenate(makeDOMGenerators([].slice.call(nodeList)));
    };
    /**
     * Rolls a tag's attributes and content into a properties object
     *  for tagHandlers to use
     */
    let callTagHandler = (tagName, node) => {
      let properties = {};
      each.call(node.attributes, (attribute) => {
        properties[attribute.nodeName] = attribute.nodeValue;
      });
      properties.TEMPLATE = encapsulate(node.childNodes);
      return exports.tagHandlers[tagName](properties)
    };
    /**
     * Custom template generators for tags
     */
    let tagHandlers = {
      /**
       * Does not render the child nodes unless `expression` is true
       * <if cond="expression">...</if>
       */
      'if': props => {
        return condition(props.TEMPLATE, null, props.cond);
      },
      /**
       * Does not render the child nodes unless `expression` is false
       * <unless cond="expression">...</unless>
       */
      'unless': props => {
        return condition(null, props.TEMPLATE, props.cond);
      },
      /**
       * Returns a template that renders either the template referenced by `from` or the
       *  list of child nodes for each of the object referenced by `each`
       *  e.g., <for each="expression"
                     [as="name"]
                     [index="name"]
                     [from="expression"]>
                  ...
                 </for>
       */
      'for': props => {
        return list(props.template || props.TEMPLATE, props.each, props.as, props.index);
      },
      /**
       * Returns a template that pulls in a template as referenced by `expression`,
       *  providing the child template to `yield`
       *  e.g., <view template="expression" state="expression">...</view>
       */
      'view': props => {
        return transclude(props.TEMPLATE, props.template, props.state);
      },
      /**
       * <yield />
       *  Renders the child template as passed from `view`
       */
      'yield': props => {
        return (doc, state, dispatch) => {
          let childState = assign({}, state);
          delete childState[YIELD];
          return state[YIELD](doc, childState, dispatch);
        };
      }
    };
    /**
     * Utility function for flag-like attributes
     */
    let flagList = (value, state) => {
      return value.map((v, i) => {
        if ((i % 2) === 0) {
          return v;
        } else {
          let r = v(state);
          if (r === true) {
            return v.expression.replace(/^[^\.]*\./, '');
          }
          if (!r) {
            return '';
          }
          return r;
        }
      }).join('').trim();
    };

    let attributeHandlers = {
      /**
       * handler for `@class`; casts boolean evaluation results
       *  as their expression
       */
      'class': (state, element, value) => {
        element.className = flagList(value, state);
      }
    };
    /**
     * Create a tag handler from a template and a list of property names
     */
    let handler = (name, propNames, template) => {
      let tpl = template;
      if (typeof tpl === 'string') {
        tpl = compile(template);
      }
      if (isArray(tpl)) {
        tpl = concatenate(tpl);
      }
      exports.tagHandlers[name] = props => {
        let getters = propNames.reduce((g, p) => {
          g[p] = getter(props[p]);
          return g;
        }, {});
        let adjustState = state => {
          let localState = assign({}, state);
          keys(getters).forEach(p => {
            localState[p] = getters[p](state);
          });
          return localState;
        };
        return (doc, state, dispatch) => {
          let ret = tpl(doc, adjustState(state), dispatch);
          ret.update = adjustUpdate(ret.update, adjustState);
          return ret;
        };
      };
    };
    /**
     * Utility function for injecting an adjustment in state.
     *  adjust SHOULD NOT mutate state, but return a new object
     */
    let adjustUpdate = (update, adjust) => {
      return (state) => {
        update(adjust(state));
      };
    };
    /**
     * Compile a template, optionally with filename if known
     */
    let compile = (tpl, filename) => {
      let dom = PARSER.parseFromString('<G>' + tpl + '</G>', 'text/xml');
      let err = dom.getElementsByTagName(PARSERERROR)[0];
      if (err) {
        throw new TemplateError(dom.querySelector(`${PARSERERROR}>div`), filename);
      }
      let generators = makeDOMGenerators([].slice.call(dom.childNodes[0].childNodes));
      return concatenate(generators);
    };
    /**
     * Add an asynchronous template to the registry
     *  @param url  path on server of the template
     *  @param loadingClass classname for placeholder div; default=glace-loading
     *  @return a template function.
     *    The template function will have a member, `.fetch`
     *    that will pre-fetch the template.  If not called, the
     *    template will be fetched on first use.
     */
    let fetchTemplate = (url, loadingClass) => {
      // For async templates, leave a marker, then
      //  transclude in when resolved.
      let realTemplate;
      let promise = null;
      let grab = () => {
        promise = fetch(url)
          .then(response => response.text())
          .then(text => compile(text, url));
        return promise;
      };
      template = (d, s, dispatch) => {
        if (realTemplate) {
          return realTemplate(d, s, dispatch);
        }
        if (!promise) grab();
        let marker = fragParent(assign(d.createElement('div'), {
          className: loadingClass || 'glace-loading'
        }));
        let output = [marker];
        let currentState = s;
        let update = newState => { currentState = newState; };
        promise.then(realTemplate => {
          let rendered = realTemplate(d, currentState, dispatch);
          update = rendered.update;
          rendered.output.forEach(child => {
            before(child, marker);
            output.push(child);
          });
          output.shift();
          remove(marker);
        });
        return {
          output,
          update: newState => update(newState)
        };
      };
      template.fetch = grab;
      return template;
    };
    /**
     * Drying function for adding a template from a tag
     **/
    let registerTemplate = (id, props, fn) => {
      let template;
      if (TEMPLATES[id]) {
        template = TEMPLATES[id];
      } else {
        template = fn();
      }
      if (props) {
        props = props.split(',').map(name => name.trim());
        handler(id, props, template);
      }
      TEMPLATES[id] = template;
    }
    assign(exports, {
      compile: compile,
      fetch: fetchTemplate,
      append: append,
      tagHandlers: tagHandlers,
      tagHandler: handler,
      getter: getter,
      registerTemplate: registerTemplate,
      Error: TemplateError
    });

    return exports;
  };
  (function () {
    try {
      try {
        define("Glace", () => GlaceFactory);
      } catch (e) {
        module.exports = GlaceFactory;
      }
    } catch (f) {
      let Glace = window.Glace = GlaceFactory(new DOMParser());
      // Read all the template references off the page.
      //  If a `props` attribute is present, make it a handler.
      each.call(document.querySelectorAll(`script[id][type="${CONTENT_TYPE}"]`), el => {
        Glace.registerTemplate(scr.id, scr.getAttribute('props'), () => Glace.compile(scr.textContent, '#' + scr.id));
      });
      each.call(document.querySelectorAll('meta[glace-template]'), meta => {
        let url = meta.getAttribute('glace-template');
        let id = url.replace(/^.*\/|\.tpl$/g, '');
        Glace.registerTemplate(id, meta.getAttribute('props'), () => Glace.fetchTemplate(url, meta.getAttribute('loading-class')));
      });
    }
  }());
}());
