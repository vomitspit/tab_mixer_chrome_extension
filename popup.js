const stageBtn = document.getElementById("stage-btn");
const mixerBtn = document.getElementById("mixer-btn");
const status = document.getElementById("status");

// Check if current tab is already staged
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const currentTab = tabs[0];
  
  if (!currentTab || !currentTab.id) return;
  
  // Check if this tab can be captured
  const cannotCapture = !currentTab.url || (
    currentTab.url.startsWith("chrome://") ||
    currentTab.url.startsWith("chrome-extension://") ||
    currentTab.url.startsWith("edge://") ||
    currentTab.url.startsWith("about:") ||
    currentTab.url.startsWith("chrome-search://") ||
    currentTab.url.includes("chrome.google.com/webstore")
  );
  
  if (cannotCapture) {
    stageBtn.disabled = true;
    stageBtn.textContent = "CANNOT STAGE THIS TAB";
    status.textContent = "Chrome internal pages cannot be recorded";
    return;
  }
  
  // Check if already staged
  chrome.storage.local.get(['stagedTabs'], result => {
    const stagedTabs = result.stagedTabs || {};
    
    if (stagedTabs[currentTab.id]) {
      stageBtn.classList.add("staged");
      stageBtn.textContent = "✓ TAB STAGED";
      status.textContent = "This tab is ready for recording";
    } else {
      status.textContent = "Click to stage this tab for recording";
    }
    
    // Show count of staged tabs
    const count = Object.keys(stagedTabs).length;
    if (count > 0) {
      status.textContent += `\n\n${count} tab(s) currently staged`;
    }
  });
});

// Stage current tab
stageBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const currentTab = tabs[0];
    
    if (!currentTab || !currentTab.id) return;
    
    chrome.storage.local.get(['stagedTabs'], result => {
      const stagedTabs = result.stagedTabs || {};
      
      // Store tab info
      stagedTabs[currentTab.id] = {
        id: currentTab.id,
        title: currentTab.title,
        url: currentTab.url,
        stagedAt: Date.now()
      };
      
      chrome.storage.local.set({ stagedTabs }, () => {
        stageBtn.classList.add("staged");
        stageBtn.textContent = "✓ TAB STAGED";
        status.textContent = "This tab is ready for recording\n\n" +
          `${Object.keys(stagedTabs).length} tab(s) currently staged`;
      });
    });
  });
});

// Open mixer
mixerBtn.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("controller.html")
  });
  window.close();
});
