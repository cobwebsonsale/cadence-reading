Feature: A text editor on the side to collect snippets and jot down notes while reading a document.

Location
- Text editor should be a full page scratch pad on the left of the screen, next to the doc.

Requirements
- Milestone 1
    - A side-bar section on the left of the page exists to capture notes and snippets. This section is collapsable at the top.
    - Selecting text on the reader screen, pops up an icon to snip / cut next to the selection
    - Clicking this icon, animates the text, being taken to the left note-taking section, and gets appended to the bottom of the existing text.
        - If the side-bar is collapsed, it opens up
    - A horizontal rule is added if a previous snippet or note exists
    - The snippet is formatted in a "quote" fashion, with a lighter background, quotes around it, and italicised
    - This data in the side-bar should be stored locally in the browser
- Milestone 2
    - Adding notes. The space in the side-bar should be a running editor window that lets users type text
    - A text-formatting bar at the top should allow some features, for bold, italics, underline, lists (ordered and otherwise), links, horizontal rule
    - Markdown for these formatting options is also supported
    - This data is also stored locally
    - Double return press should result in a horizontal rule
    - The horizontal rules that are automatically added should be possible to remove
