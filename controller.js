const mixer = document.getElementById("mixer");
const header = document.getElementById("header");

const channels = [];

/* ---------- KEY MAPS ---------- */

const DROP_GAIN_KEYS = "qwertyuiop".split("");
const MASTER_MUTE_KEYS = "1234567890".split("");

const VOL_UP_KEYS = "asdfghjkl;".split("");
const VOL_DOWN_KEYS = "zxcvbnm,./".split("");

/* ---------- VOLUME STEPS ---------- */

const VOL_STEP = 0.20;
const VOL_FINE_STEP = 0.05;
const VOL_COARSE_STEP = 0.80;

const FLASH_DURATION = 50;

window.focus();

/* ---------- BUILD UI ---------- */

chrome.tabs.getCurrent(controllerTab => {
  const controllerTabId = controllerTab?.id;

  chrome.tabs.query({ currentWindow: true }, tabs => {
    tabs.forEach(tab => {
      if (!tab.id) return;
      if (tab.id === controllerTabId) return;

      const index = channels.length;

      const isYouTube =
        tab.url &&
        (tab.url.includes("youtube.com/watch") ||
         tab.url.includes("youtube.com/live"));

      const channelEl = document.createElement("div");
      channelEl.className = "channel";

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = `${index + 1}: ${tab.title || "Untitled"}`;

      /* ---------- MASTER MUTE ---------- */

      const muteBtn = document.createElement("button");

      function refreshMasterMute() {
        chrome.tabs.get(tab.id, t => {
          if (!t) return;
          const muted = t.mutedInfo.muted;
          muteBtn.textContent = muted ? "UNMUTE" : "MUTE";
          muteBtn.classList.toggle("muted", muted);
        });
      }

      refreshMasterMute();
      muteBtn.onclick = () => toggleMasterMute(index);

      channelEl.appendChild(title);
      channelEl.appendChild(muteBtn);

      /* ---------- YOUTUBE SEND ---------- */

      let sendBtn = null;
      let slider = null;

      const channelState = {
        tabId: tab.id,
        isYouTube,
        channelEl,
        muteBtn,
        sendBtn: null,
        slider: null,
        sendMuted: false,
        storedSendVolume: 1.0
      };

      if (isYouTube) {
        sendBtn = document.createElement("button");
        sendBtn.textContent = "DROP GAIN";
        sendBtn.onclick = () => toggleSendMute(index);

        channelEl.appendChild(sendBtn);

        const sliderWrap = document.createElement("div");
        sliderWrap.className = "slider-wrapper";

        slider = document.createElement("input");
        slider.type = "range";
        slider.min = 0;
        slider.max = 100;
        slider.value = 100;

        slider.oninput = () => {
          if (channelState.sendMuted) return;
          const vol = slider.value / 100;
          channelState.storedSendVolume = vol;
          setVideoVolume(channelState.tabId, vol);
          flash(channelEl);
        };

        sliderWrap.appendChild(slider);
        channelEl.appendChild(sliderWrap);

        channelState.sendBtn = sendBtn;
        channelState.slider = slider;

        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id },
            func: () => document.querySelector("video")?.volume
          },
          res => {
            if (res && res[0]?.result != null) {
              channelState.storedSendVolume = res[0].result;
              slider.value = Math.round(res[0].result * 100);
            }
          }
        );
      }

      channels.push(channelState);
      mixer.appendChild(channelEl);
    });

    if (channels.length > 10) {
      const warn = document.createElement("div");
      warn.style.borderTop = "1px solid #fff";
      warn.style.padding = "6px 12px";
      warn.style.fontSize = "11px";
      warn.textContent =
        "WARNING: Only first 10 tabs are hot-key controllable";
      header.appendChild(warn);
    }
  });
});

/* ---------- HELPERS ---------- */

function flash(el) {
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), FLASH_DURATION);
}

function setVideoVolume(tabId, volume) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: v => {
      const vid = document.querySelector("video");
      if (vid) vid.volume = v;
    },
    args: [volume]
  });
}

function toggleMasterMute(index) {
  const ch = channels[index];
  if (!ch) return;

  chrome.tabs.get(ch.tabId, t => {
    if (!t) return;
    const nowMuted = !t.mutedInfo.muted;

    chrome.tabs.update(
      ch.tabId,
      { muted: nowMuted },
      () => {
        ch.muteBtn.textContent = nowMuted ? "UNMUTE" : "MUTE";
        ch.muteBtn.classList.toggle("muted", nowMuted);
        flash(ch.channelEl);
      }
    );
  });
}

function toggleSendMute(index) {
  const ch = channels[index];
  if (!ch || !ch.isYouTube) return;

  if (!ch.sendMuted) {
    ch.sendMuted = true;
    ch.sendBtn.textContent = "RESTORE GAIN";
    ch.sendBtn.classList.add("muted");
    ch.slider.value = 0;
    setVideoVolume(ch.tabId, 0);
  } else {
    ch.sendMuted = false;
    ch.sendBtn.textContent = "DROP GAIN";
    ch.sendBtn.classList.remove("muted");
    ch.slider.value = Math.round(ch.storedSendVolume * 100);
    setVideoVolume(ch.tabId, ch.storedSendVolume);
  }

  flash(ch.channelEl);
}

function nudgeVolume(index, delta) {
  const ch = channels[index];
  if (!ch || !ch.isYouTube || ch.sendMuted) return;

  const newVol = Math.max(
    0,
    Math.min(1, ch.storedSendVolume + delta)
  );

  ch.storedSendVolume = newVol;
  ch.slider.value = Math.round(newVol * 100);
  setVideoVolume(ch.tabId, newVol);
  flash(ch.channelEl);
}

/* ---------- KEYBOARD ---------- */

window.addEventListener("keydown", e => {
  if (e.repeat) return;

  const key = e.key.toLowerCase();
  let index;

  let step = VOL_STEP;
  if (e.shiftKey) step = VOL_COARSE_STEP;
  else if (e.ctrlKey) step = VOL_FINE_STEP;

  if ((index = DROP_GAIN_KEYS.indexOf(key)) !== -1) {
    toggleSendMute(index);
    e.preventDefault();
    return;
  }

  if ((index = MASTER_MUTE_KEYS.indexOf(key)) !== -1) {
    toggleMasterMute(index);
    e.preventDefault();
    return;
  }

  if ((index = VOL_UP_KEYS.indexOf(key)) !== -1) {
    nudgeVolume(index, +step);
    e.preventDefault();
    return;
  }

  if ((index = VOL_DOWN_KEYS.indexOf(key)) !== -1) {
    nudgeVolume(index, -step);
    e.preventDefault();
    return;
  }
});

// Keep tabs up to date
chrome.tabs.onCreated.addListener(() => {
  location.reload();
});

chrome.tabs.onRemoved.addListener(() => {
  location.reload();
});
