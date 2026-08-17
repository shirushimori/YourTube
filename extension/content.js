(() => {
  const BUTTON_ID = "yourtube-download-btn";

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const isVideoPage = /\/watch\?v=/.test(location.href);
    if (!isVideoPage) return;

    const target = document.querySelector(
      "#above-the-fold #title, ytd-watch-metadata #title"
    );
    if (!target) return;

    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.textContent = "Download";
    btn.style.cssText = `
      background: #ff0000;
      color: white;
      border: none;
      border-radius: 20px;
      padding: 8px 16px;
      margin-left: 12px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      vertical-align: middle;
      font-family: Roboto, Arial, sans-serif;
    `;
    btn.addEventListener("mouseenter", () => (btn.style.background = "#cc0000"));
    btn.addEventListener("mouseleave", () => (btn.style.background = "#ff0000"));
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: "open_popup", url: location.href });
      chrome.runtime.sendMessage({ type: "fetch_metadata", url: location.href }, () => {});
      window.postMessage({ source: "yourtube", action: "open_popup" }, "*");
    });

    const parent = target.closest("ytd-watch-metadata #above-the-fold") || target.parentElement;
    if (parent) parent.appendChild(btn);
  }

  const observer = new MutationObserver(() => injectButton());
  observer.observe(document.body, { childList: true, subtree: true });
  injectButton();
})();
