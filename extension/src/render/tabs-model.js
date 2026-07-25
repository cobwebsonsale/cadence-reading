export function listTabs(doc) {
  const out = [];
  const walk = (tabs, level) => {
    for (const tab of tabs || []) {
      const props = tab.tabProperties || {};
      out.push({ tabId: props.tabId || '', title: props.title || '', level });
      if (tab.childTabs?.length) walk(tab.childTabs, level + 1);
    }
  };
  if (Array.isArray(doc?.tabs)) walk(doc.tabs, 0);
  return out;
}

function findTab(tabs, tabId) {
  for (const tab of tabs || []) {
    if (tab.tabProperties?.tabId === tabId) return tab;
    const child = tab.childTabs && findTab(tab.childTabs, tabId);
    if (child) return child;
  }
  return null;
}

function firstTabWithBody(tabs) {
  for (const tab of tabs || []) {
    if (tab.documentTab?.body?.content?.length) return tab;
    const child = tab.childTabs && firstTabWithBody(tab.childTabs);
    if (child) return child;
  }
  return null;
}

function selectTab(doc, tabId) {
  if (!Array.isArray(doc?.tabs) || !doc.tabs.length) return null;
  return (tabId && findTab(doc.tabs, tabId)) || firstTabWithBody(doc.tabs) || doc.tabs[0];
}

export function resolveTabId(doc, tabId) {
  return selectTab(doc, tabId)?.tabProperties?.tabId || null;
}

export function tabTitle(doc, tabId) {
  return selectTab(doc, tabId)?.tabProperties?.title || '';
}

export function resolveTabContent(doc, tabId) {
  const tab = selectTab(doc, tabId);
  if (tab) {
    const documentTab = tab.documentTab || {};
    return {
      content: documentTab.body?.content || [],
      lists: documentTab.lists || doc.lists,
      inlineObjects: documentTab.inlineObjects || doc.inlineObjects,
    };
  }
  return {
    content: doc?.body?.content || [],
    lists: doc?.lists,
    inlineObjects: doc?.inlineObjects,
  };
}
