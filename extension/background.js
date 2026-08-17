chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "getTabUrl") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ url: tabs[0]?.url || "" });
    });
    return true;
  }

  if (msg.type === "fetch_metadata" || msg.type === "download") {
    chrome.runtime.sendNativeMessage(
      { name: "com.yourtube.client" },
      msg,
      (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ type: "error", message: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      }
    );
    return true;
  }
});
