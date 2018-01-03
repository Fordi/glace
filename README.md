# Glacé

Glacé is a sweet glaze to put atop Redux

## What this really is

Glacé aspires to be a simple, fast, small, and elegant view layer for simple Redux-based apps.  Its templates are entirely
well-formed XML fragments and it outputs real DOM in real time.

## Architecture discussion

The design goal of Glacé was to make a `template` as simple a thing as made sense, based on just one Type and Interface 
(forgive the Java-like syntax):

    interface TemplateResult {Glacé
        void update(Object newState);
        Array<Node> output;
    }

    TemplateResult template(Document document, Object state)

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
