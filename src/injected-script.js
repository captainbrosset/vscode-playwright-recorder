function positionInNodeList(el, nodeList) {
    for (let i = 0; i < nodeList.length; i++) {
        if (el === nodeList[i]) {
            return i;
        }
    }
    return -1;
}

function findUniqueCssSelector(el) {
    const doc = el.ownerDocument;

    if (el.id && doc.querySelectorAll("#" + CSS.escape(el.id)).length === 1) {
        return "#" + CSS.escape(el.id);
    }

    // Inherently unique by tag name
    const tagName = el.localName;
    if (tagName === "html") {
        return "html";
    }
    if (tagName === "head") {
        return "head";
    }
    if (tagName === "body") {
        return "body";
    }

    // We might be able to find a unique class name
    let selector, index, matches;
    for (let i = 0; i < el.classList.length; i++) {
        // Is this className unique by itself?
        selector = "." + CSS.escape(el.classList.item(i));
        matches = doc.querySelectorAll(selector);
        if (matches.length === 1) {
            return selector;
        }
        // Maybe it's unique with a tag name?
        selector = CSS.escape(tagName) + selector;
        matches = doc.querySelectorAll(selector);
        if (matches.length === 1) {
            return selector;
        }
        // Maybe it's unique using a tag name and nth-child
        index = positionInNodeList(el, el.parentNode.children) + 1;
        selector = selector + ":nth-child(" + index + ")";
        matches = doc.querySelectorAll(selector);
        if (matches.length === 1) {
            return selector;
        }
    }

    // Not unique enough yet.
    index = positionInNodeList(el, el.parentNode.children) + 1;
    selector = CSS.escape(tagName) + ":nth-child(" + index + ")";
    if (el.parentNode !== doc) {
        selector = findUniqueCssSelector(el.parentNode) + " > " + selector;
    }
    return selector;
}

function makeTargetSelector(e) {
    return findUniqueCssSelector(e.target);
}

function makeEventData(e) {
    return {
        type: e.type,
        target: makeTargetSelector(e),
        key: e.key,
        inputValue: e.target.value + (e.key && e.key.length === 1 ? e.key : ''),
    };
}

let highlighter;

function highlightOnHover(e) {
    if (!highlighter) {
        highlighter = document.createElement('div');
        highlighter.style.position = 'absolute';
        highlighter.style.zIndex = '1000';
        highlighter.style.background = '#f005';
        highlighter.style.pointerEvents = 'none';
        document.body.appendChild(highlighter);
    }
    const rect = e.target.getBoundingClientRect();
    highlighter.style.top = rect.top + 'px';
    highlighter.style.left = rect.left + 'px';
    highlighter.style.width = rect.width + 'px';
    highlighter.style.height = rect.height + 'px';
}

window.addEventListener('mousemove', e => highlightOnHover(e));
window.addEventListener('mousedown', e => window.playwrightRecorderActionTracker(makeEventData(e)));
window.addEventListener('mouseup', e => window.playwrightRecorderActionTracker(makeEventData(e)));
window.addEventListener('click', e => window.playwrightRecorderActionTracker(makeEventData(e)));
// Only keypresses are needed it seems.
window.addEventListener('keypress', e => window.playwrightRecorderActionTracker(makeEventData(e)));