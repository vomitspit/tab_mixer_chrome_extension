const mixer = document.getElementById("mixer");
const header = document.getElementById("header");

const channels = [];

let isRecording = false;
const activeRecordings = new Map(); // tabId -> { mediaRecorder, chunks, startTime }

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
    // Get staged tabs from storage
    chrome.storage.local.get(['stagedTabs'], result => {
      const stagedTabs = result.stagedTabs || {};
      const stagedTabIds = Object.keys(stagedTabs).map(id => parseInt(id));
      
      // Clean up staged tabs that no longer exist
      const currentTabIds = tabs.map(t => t.id);
      const cleanedStagedTabs = {};
      let hasChanges = false;
      
      for (const tabId in stagedTabs) {
        if (currentTabIds.includes(parseInt(tabId))) {
          cleanedStagedTabs[tabId] = stagedTabs[tabId];
        } else {
          hasChanges = true;
        }
      }
      
      if (hasChanges) {
        chrome.storage.local.set({ stagedTabs: cleanedStagedTabs });
      }
      
      // Only show staged tabs
      const stagedTabsToShow = tabs.filter(tab => 
        tab.id && 
        tab.id !== controllerTabId && 
        stagedTabIds.includes(tab.id)
      );
      
      if (stagedTabsToShow.length === 0) {
        const notice = document.createElement("div");
        notice.style.padding = "20px";
        notice.style.textAlign = "center";
        notice.style.fontSize = "12px";
        notice.innerHTML = `
          <div style="border: 1px solid #fff; padding: 20px;">
            <div style="font-size: 14px; margin-bottom: 10px;">NO STAGED TABS</div>
            <div>To record tabs, you need to stage them first:</div>
            <div style="margin-top: 10px; text-align: left; padding-left: 20px;">
              1. Click on a tab you want to record<br>
              2. Click the Tab Mixer extension icon<br>
              3. Click "STAGE THIS TAB FOR RECORDING"<br>
              4. Repeat for each tab<br>
              5. Return here to start recording
            </div>
          </div>
        `;
        mixer.appendChild(notice);
        return;
      }
      
      stagedTabsToShow.forEach(tab => {
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

/* ---------- RECORDING ---------- */

function startRecording(channel) {
  // Check if already recording this tab
  if (activeRecordings.has(channel.tabId)) {
    console.log("Tab already being recorded:", channel.tabId);
    return;
  }

  console.log("Attempting to start recording tab:", channel.tabId);

  // Request permission to capture the specific tab
  chrome.tabCapture.getMediaStreamId(
    { targetTabId: channel.tabId },
    (streamId) => {
      if (!streamId || chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError?.message || "Unknown error";
        console.error("Failed to get stream ID for tab", channel.tabId);
        console.error("Chrome error:", errorMsg);
        
        // Show user-friendly error
        if (errorMsg.includes("not been invoked")) {
          console.log(`Tab ${channel.tabId} hasn't been visited recently`);
          // Don't show alert for this one - the main toggle will explain
        } else if (errorMsg.includes("Chrome pages cannot be captured") || 
            errorMsg.includes("Cannot capture")) {
          console.log(`Tab ${channel.tabId} cannot be captured (Chrome internal page)`);
        } else if (errorMsg.includes("active stream")) {
          console.error(`Tab ${channel.tabId} already has an active stream`);
        } else {
          console.error(`Cannot record tab ${channel.tabId}: ${errorMsg}`);
        }
        
        return;
      }

      console.log("Got stream ID:", streamId, "for tab:", channel.tabId);

      // Use the streamId to get the actual media stream
      navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId
          }
        }
      })
      .then(stream => {
        console.log("Got media stream for tab:", channel.tabId);
        
        // Create audio loopback so user can hear the audio
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        
        // Connect directly to output for playback
        source.connect(audioContext.destination);
        
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: "audio/webm"
        });

        const chunks = [];

        mediaRecorder.ondataavailable = e => {
          if (e.data.size > 0) {
            chunks.push(e.data);
            console.log("Got audio chunk:", e.data.size, "bytes");
          }
        };

        mediaRecorder.onstop = () => {
          stream.getTracks().forEach(track => track.stop());
          // Clean up audio context
          audioContext.close();
        };

        mediaRecorder.start();
        console.log("MediaRecorder started for tab:", channel.tabId);

        activeRecordings.set(channel.tabId, {
          mediaRecorder,
          chunks,
          stream,
          audioContext,
          startTime: Date.now(),
          tabTitle: channel.channelEl.querySelector(".title").textContent
        });

        // Add visual feedback
        channel.channelEl.classList.add("recording");
        console.log("Recording started successfully for tab:", channel.tabId);
      })
      .catch(error => {
        console.error("Error getting media stream:", error);
      });
    }
  );
}

function stopRecording(channel) {
  const recording = activeRecordings.get(channel.tabId);
  if (!recording) {
    // Even if not in our map, remove the red border just in case
    channel.channelEl.classList.remove("recording");
    return;
  }

  console.log("Stopping recording for tab:", channel.tabId);

  // Set up the stop handler BEFORE stopping
  recording.mediaRecorder.onstop = () => {
    console.log("MediaRecorder stopped, chunks:", recording.chunks.length);
    
    // Stop all tracks
    if (recording.stream) {
      recording.stream.getTracks().forEach(track => {
        track.stop();
        console.log("Stopped track:", track.kind);
      });
    }
    
    // Close audio context
    if (recording.audioContext) {
      recording.audioContext.close();
      console.log("Closed audio context");
    }
    
    // Convert webm to wav
    const blob = new Blob(recording.chunks, { type: "audio/webm" });
    console.log("Blob size:", blob.size);
    
    if (blob.size > 0) {
      convertToWavAndDownload(blob, recording.tabTitle);
    } else {
      console.error("Recording blob is empty");
      alert(`Recording for "${recording.tabTitle}" failed: No audio data captured.`);
    }
    
    // Clean up - make sure this happens regardless
    activeRecordings.delete(channel.tabId);
    channel.channelEl.classList.remove("recording");
    console.log("Cleanup complete for tab:", channel.tabId);
  };

  // Stop the recorder
  try {
    if (recording.mediaRecorder.state !== 'inactive') {
      recording.mediaRecorder.stop();
    } else {
      console.log("MediaRecorder already stopped, forcing cleanup");
      // Force cleanup if already stopped
      if (recording.stream) {
        recording.stream.getTracks().forEach(track => track.stop());
      }
      if (recording.audioContext) {
        recording.audioContext.close();
      }
      activeRecordings.delete(channel.tabId);
      channel.channelEl.classList.remove("recording");
    }
  } catch (error) {
    console.error("Error stopping recording:", error);
    // Force cleanup on error
    if (recording.stream) {
      recording.stream.getTracks().forEach(track => track.stop());
    }
    if (recording.audioContext) {
      recording.audioContext.close();
    }
    activeRecordings.delete(channel.tabId);
    channel.channelEl.classList.remove("recording");
  }
}

async function convertToWavAndDownload(webmBlob, tabTitle) {
  try {
    const audioContext = new AudioContext();
    const arrayBuffer = await webmBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Convert to WAV
    const wavBuffer = audioBufferToWav(audioBuffer);
    const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });

    // Download
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(tabTitle)}_${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error converting to WAV:", error);
  }
}

function audioBufferToWav(audioBuffer) {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numberOfChannels * bytesPerSample;

  const data = [];
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    data.push(audioBuffer.getChannelData(i));
  }

  const interleaved = interleave(data);
  const dataLength = interleaved.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  // Write audio data
  const offset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const sample = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(
      offset + i * bytesPerSample,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true
    );
  }

  return buffer;
}

function interleave(channelData) {
  const length = channelData[0].length;
  const numberOfChannels = channelData.length;
  const result = new Float32Array(length * numberOfChannels);

  let offset = 0;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      result[offset++] = channelData[channel][i];
    }
  }

  return result;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-z0-9]/gi, "_")
    .replace(/_+/g, "_")
    .substring(0, 50);
}

function toggleRecording() {
  if (!isRecording) {
    // Start recording all staged tabs
    if (channels.length === 0) {
      alert("No staged tabs to record");
      return;
    }

    isRecording = true;
    
    const recordBtn = document.getElementById("record-btn");
    const recordStatus = document.getElementById("record-status");
    recordBtn.textContent = "STOP RECORDING";
    recordBtn.classList.add("recording");
    recordStatus.textContent = `Starting ${channels.length} recording(s)...`;
    
    // Start recordings
    setTimeout(() => {
      channels.forEach(startRecording);
      
      // Update status after a moment to reflect actual recordings
      setTimeout(() => {
        const actualRecordings = channels.filter(ch => 
          activeRecordings.has(ch.tabId)
        ).length;
        
        if (actualRecordings > 0) {
          recordStatus.textContent = `Recording ${actualRecordings} channel(s)...`;
        } else {
          // No recordings started successfully
          recordStatus.textContent = "Failed to start recordings - check console";
          recordBtn.textContent = "START RECORDING";
          recordBtn.classList.remove("recording");
          isRecording = false;
        }
      }, 500);
    }, 100);
    
  } else {
    // Stop recording
    isRecording = false;
    
    const recordingChannels = channels.filter(ch => 
      activeRecordings.has(ch.tabId)
    );
    
    if (recordingChannels.length === 0) {
      const recordBtn = document.getElementById("record-btn");
      const recordStatus = document.getElementById("record-status");
      recordBtn.textContent = "START RECORDING";
      recordBtn.classList.remove("recording");
      recordStatus.textContent = "No active recordings to stop";
      setTimeout(() => recordStatus.textContent = "", 2000);
      return;
    }
    
    recordingChannels.forEach(stopRecording);
    
    const recordBtn = document.getElementById("record-btn");
    const recordStatus = document.getElementById("record-status");
    recordBtn.textContent = "START RECORDING";
    recordBtn.classList.remove("recording");
    recordStatus.textContent = `Processing ${recordingChannels.length} recording(s)...`;
    
    setTimeout(() => {
      recordStatus.textContent = "";
    }, 3000);
  }
}

// Set up record button
window.addEventListener("DOMContentLoaded", () => {
  const recordBtn = document.getElementById("record-btn");
  if (recordBtn) {
    recordBtn.onclick = toggleRecording;
  }
});

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
