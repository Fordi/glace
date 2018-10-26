# Glacé

Glacé is a sweet glaze to put atop Redux

## What this really is

Glacé aspires to be a simple, fast, small, and elegant view layer for simple Redux-based apps.  Its templates are entirely
well-formed XML fragments and it outputs real DOM in real time.

## Architecture discussion

The design goal of Glacé was to make a `template` as simple a thing as made sense, based on just one Type and Interface
(forgive the Java-like syntax):

    interface GlaceTemplateResult {
        void update(Object newState);
        Array<DOMNode> output;
    }

    GlaceTemplateResult template(Document document, Object state)

That is, you pass an owning document and state to the `template`, and it returns a list of nodes as `returnValue.output`
and an updater function as `returnValue.update(state)`.  There is no owning class; views' appearance is based solely on
the state and the template, and the template has as little logic as possible.

This simplified the process of parsing and compilation; we simply parse the template as DOM, then walk the DOM tree,
creating templates and subtemplates as needed.

Security was not considered; it is assumed that you (the developer) own the templates, and would not put malicious code
into them.  This allowed us to use `new Function()` for fetching values off the state, enabling the whole compilation process
to be, essentially, an exercise in lambda calculus.

### The transclusion problem

`<if>`, `<for>`, and `<view>` are tags that are troublesome for any live templating engine to deal with - specifically,
knowing where the DOM's insertion points should be post-render.

Angular necessarily wraps children of these with an element, which can cause troubles for table rendering.  Ember 1.x did it
with `<script>` tags, which, while effective, looks messy when inspecting.

Glacé makes use of a quirk of a live DOM: empty DOM text nodes.  These can't be seen in the inspection view, but will maintain
an insertion point in the DOM tree.

## Template examples

### Static text

    This is a test.

Outputs what you'd expect:

    This is a test.

### Substitutions

Transclusions of state variables are done using something akin to Javascript's Template Literals:

    This is a ${type}.

Which, when rendered with `{ type: 'sample' }`, results in:

    This is a sample.

As with Template literals, these are evaluated as Javascript:

    1 + 1 = ${1 + 1}

    1 + 1 = 2

Attributes are also supported in this way:

    <div class="${classNames}"></div>

Rendered with `{ classNames: 'my-class your-class' }`:

    <div class="my-class your-class"></div>

Templates also support minimal structuring, e.g., conditions and loops:

    <if cond="showValue">
        Value shown! ${value}
    </if>
    <!-- cannot else (yet) -->
    <unless cond="showValue">
        Value not shown!
    </unless>
    <for each="values" as="value">
        ${value}
    </for>

#### More on `<for>`

`<for>` accepts the following attributes:

* `each` - The list to iterate against
* `template` - Which template to use for each item.  If not present, the child DOM is used.
* `as` - The name of each item in the child's state.  By default, this is `content`
* `index` - The name of the index for each item in the child's state.  By default, this is `index`

### Predefined templates

Like most other templaters, Glacé can pick up templates defined in the page header:

    <script type="text/glace-template" id="heading3">
      <h3>${content}</h3>
    </script>

It can also pick up templates asynchronously:

    <meta glace-template="my-template.tpl" />

To invoke Glacé, simply append a template to a DOM element with a state (which can be empty):

    let update = Glace.append(document.body, template, {});

When the state changes, run the update command:

    update({title: 'Yer a wizard, `arry');

Glacé is aware of Redux; if you pass it a Redux `Store`, it will subscribe to it and update as actions are passed - so
you can ignore the `update` function returned.

    let store = Redux.createStore(myReducer);
    Glace.append(document.body, template, reduxStore);

Later, when actions are dispatched to the store, the templates will update automatically.

### Templates as tag handlers

Templates can be defined as tag handlers by adding a comma-delimited `props` list to their declaration:

    <script type="text/glace-template" id="head-with-sub" props="head, subhead">
      <header>
          <h1>${head}</h1>
          <if cond="subhead">
            <h2>${subhead}</h2>
          </if>
      </header>
    </script>

You can then use this template elsewhere:

    <head-with-sub head="content.title" subhead="content.subtitle" />

This works just as well with async templates:

    <meta glace-template="my-template.tpl" props="foo, bar" />

    ...

    <my-template foo="foo" bar="status.bar" />

### Transclusion

You can also transclude a template in another using the `<view>` tag:

    <view template="shopping-cart" state="shoppingCart" />

If `state` is omitted, the child view sees the same state as the parent view.    

Views also support yielding, via the `<yield />` tag, to the referencing `<view>` tag's children.  For example:

    <script type="text/glace-template" id="inner">
       <p>Yielded content: <yield /></p>
    </script>

    <script type="text/glace-template" id="outer">
        <view template="inner">
           This will show up after `Yielded content`
        </view>
    </script>

### Advanced tag handlers and attribute handlers

`if`, `for`, and `view` are all implemented as entries in `Glace.tagHandlers`.  You can implement your own tag handler.  They are functions that accept a `props` object, containing the attributes passed to the tag (and `TEMPLATE`, which is the template for its child nodes), and return a template function as described in the architecture section above.  These are run at compile-time, and are essentially stand-ins for the normal element template function.

Attribute handlers are a different sort of beast.  They run at runtime, and accept `state`, `element`, and `value`, where `value` is a list of substitution tokens. (e.g., if a value is "I'm ${color} boo-da-bee", the substitution list will be ["I'm ", function getterForColor(state), "boo-da-bee"].  Even indices will always contain Strings, odd will always contain `function(state)`'s.  Getter functions will also have an `expression` member, containing the raw expression the function is based on.  They are not yet publicly editable.

### Events and Dispatchers

Because Glacé is written with Redux in mind, it's able to pass a dispatcher function to all child templates, which is the preferred method of handling events:

    <a href="#" on-click="return !!dispatch({ type: 'ADD_PROPERTY' })">Add</a>

You can pass parts of the state to the handler:
    <for each="myList">
        <tr>
            <th>${content.name}</th>
            <td>${content.value}</td>
            <td class="remove" on-click="dispatch({ type: 'REMOVE_PROPERTY', which: content })">
                <!-- assuming user-icon is a view we've named -->
                <user-icon name="remove" />
            </td>
        </tr>
    </for>

If you're not using Redux, you can populate this with Glace.append's fourth argument:

    let state = {};
    let util = {
      dispatch: (action) => {
       /*...*/
      },
      handleClick: (event) => {
        console.log(event);
      }
    };
    let update = Glace.append(document.body, 'my-template', state, util);

Note that inline event handlers _must_ be expressions.  If it can't be parsed as javascript
  as `() => (${attributeValue});`, it is _not_ valid.

Note also that I do not list 'supported events'; that's because this is a dumb
implmentation.  The `on-` is stripped off, and what's left is passed directly to
`addEventListener`.

### Using in your project

    $ bower install glace-tpl

Once that's done, you can use:

    <script src="bower_components/glace-tpl/dist/glace.min.js"></script>

### Caveats

See [Caveat issues](https://github.com/Fordi/glace/issues?q=is%3Aopen+is%3Aissue+label%3ACaveat).
