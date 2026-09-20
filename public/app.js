const state = {
  files: [],
  logoKey: null,
  wmKey: null,
  templateBgKey: null,
};

const $ = (id) => document.getElementById(id);
const list = $("list");

function addFiles(fileList) {
  const wasEmpty = state.files.length === 0;
  [...fileList].forEach((file) => {
    const id = crypto.randomUUID();
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="name">${file.name}</div>
      <div class="bar"><div></div></div>
      <div class="status"><span class="label">Aguardando</span><span class="link"></span></div>
    `;
    list.appendChild(el);
    state.files.push({ id, file, el, status: "waiting", percent: 0 });
  });
  $("processBtn").disabled = state.files.length === 0;
  if (wasEmpty && state.files.length) {
    setPreviewVideo(state.files[0].file);
  }
}

$("videoFiles").addEventListener("change", (e) => addFiles(e.target.files));

const dz = $("dropzone");
dz.addEventListener("dragover", (e) => e.preventDefault());
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});

function setItemProgress(item, percent, label) {
  item.percent = percent;
  item.el.querySelector(".bar > div").style.width = percent + "%";
  item.el.querySelector(".label").textContent = label;
}

function setItemError(item, msg) {
  item.status = "error";
  item.el.querySelector(".status").classList.add("error");
  item.el.querySelector(".label").textContent = "Erro: " + msg;
}

async function runWithLimit(tasks, limit) {
  const queue = [...tasks];
  const workers = new Array(limit).fill(0).map(async () => {
    while (queue.length) {
      const task = queue.shift();
      await task();
    }
  });
  await Promise.all(workers);
}

function xhrUploadToR2(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("falha no upload (" + xhr.status + ")")));
    xhr.onerror = () => reject(new Error("falha de rede no upload"));
    xhr.send(file);
  });
}

async function presignAndUpload(file, onProgress) {
  const r = await fetch("/api/presign-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });
  if (!r.ok) throw new Error("não consegui gerar URL de upload");
  const { key, url } = await r.json();
  await xhrUploadToR2(url, file, onProgress);
  return key;
}

async function uploadAsset(fileInputId) {
  const input = $(fileInputId);
  if (!input.files[0]) return null;
  return presignAndUpload(input.files[0], () => {});
}

let boxXPct = 5, boxYPct = 40, boxWPct = 90, boxHPct = 45;

function currentTemplate() {
  return {
    overlayText: $("overlayText").checked,
    invert: $("invert").checked,
    name: $("tplName").value,
    handle: $("tplHandle").value,
    handleOpacity: 0.6,
    title: $("tplTitle").value,
    pageBackground: $("pageBackground").value,
    videoBoxAspect: $("videoBoxAspect").value,
    verified: $("verified").checked,
    verifiedColor: $("verifiedColor").value,
    zoomScale: parseFloat($("zoomScale").value),
    centerOffsetY: parseFloat($("centerOffsetY").value),
    topMargin: parseFloat($("topMargin").value),
    boxXPct, boxYPct, boxWPct, boxHPct,
    watermark: {
      enabled: $("wmEnabled").checked,
      position: $("wmPosition").value,
      opacity: parseFloat($("wmOpacity").value),
    },
  };
}

const CW = 1080, CH = 1920;
const previewCanvas = $("previewCanvas");
const pctx = previewCanvas.getContext("2d");
const previewVideo = $("previewVideo");
const scaleF = previewCanvas.width / CW;
let avatarImg = null;
let templateBgImg = null;
let rafId = null;

const BG_HEX = { black: "#000000", white: "#ffffff", dim: "#15202b" };
const BADGE_HEX = { blue: "#1d9bf0", gold: "#ffd700", silver: "#829aab" };

function setPreviewVideo(file) {
  const url = URL.createObjectURL(file);
  previewVideo.src = url;
  previewVideo.play().catch(() => {});
  if (!rafId) loopDraw();
}

$("logoFile").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) { avatarImg = null; scheduleDraw(); return; }
  const img = new Image();
  img.onload = () => { avatarImg = img; scheduleDraw(); };
  img.src = URL.createObjectURL(f);
});

$("templateBgFile").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) { templateBgImg = null; scheduleDraw(); return; }
  const img = new Image();
  img.onload = () => { templateBgImg = img; scheduleDraw(); };
  img.src = URL.createObjectURL(f);
});

function wrapLinesPreview(text, maxWidth, fontSize) {
  pctx.font = `bold ${fontSize}px sans-serif`;
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (pctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function drawVideoInBox(tpl, videoBoxX, videoBoxY, videoBoxW, videoBoxH) {
  if (previewVideo.videoWidth) {
    const zoom = Math.min(1.8, Math.max(1, tpl.zoomScale || 1));
    const scaledW = videoBoxW * zoom, scaledH = videoBoxH * zoom;
    const s = Math.max(scaledW / previewVideo.videoWidth, scaledH / previewVideo.videoHeight);
    const svW = previewVideo.videoWidth * s, svH = previewVideo.videoHeight * s;
    const maxOffset = (svH - videoBoxH) / 2;
    const offsetY = Math.max(-maxOffset, Math.min(maxOffset, tpl.centerOffsetY || 0));
    const cropY = maxOffset + offsetY;
    const cropX = (svW - videoBoxW) / 2;
    const sx = cropX / s, sy = cropY / s, sw = videoBoxW / s, sh = videoBoxH / s;
    pctx.drawImage(
      previewVideo, sx, sy, sw, sh,
      videoBoxX * scaleF, videoBoxY * scaleF, videoBoxW * scaleF, videoBoxH * scaleF
    );
  } else {
    pctx.fillStyle = "#111";
    pctx.fillRect(videoBoxX * scaleF, videoBoxY * scaleF, videoBoxW * scaleF, videoBoxH * scaleF);
  }
}

function drawPreview() {
  const tpl = currentTemplate();
  const isLight = tpl.pageBackground === "white";
  const primary = isLight ? "#0f1419" : "#f7f9f9";
  const secondary = isLight ? "#536471" : "#71767b";
  const useCustomBg = !!templateBgImg;

  pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  pctx.fillStyle = useCustomBg ? "#000" : (BG_HEX[tpl.pageBackground] || "#000");
  pctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

  if (useCustomBg) {
    const videoBoxX = Math.round((CW * boxXPct) / 100);
    const videoBoxY = Math.round((CH * boxYPct) / 100);
    const videoBoxW = Math.round((CW * boxWPct) / 100);
    const videoBoxH = Math.round((CH * boxHPct) / 100);
    drawVideoInBox(tpl, videoBoxX, videoBoxY, videoBoxW, videoBoxH);
    pctx.drawImage(templateBgImg, 0, 0, previewCanvas.width, previewCanvas.height);
    return;
  }

  const cardWidth = Math.round(CW * 0.92);
  const cardX = Math.round((CW - cardWidth) / 2);
  let currentY = tpl.topMargin || 130;
  const showHeader = tpl.overlayText;
  const avatarSize = 74;
  const hasAvatar = !!avatarImg;
  const infoX = hasAvatar ? cardX + avatarSize + 20 : cardX;
  const nameFontSize = 30, handleFontSize = 24, titleFontSize = 36;
  let headerTop = currentY, nameY = currentY + 4, handleY = currentY + 42;
  let titleLines = [], titleY = 0;
  const lineHeight = Math.round(titleFontSize * 1.38);

  if (showHeader) {
    currentY += avatarSize + 24;
    if (tpl.title) {
      titleLines = wrapLinesPreview(tpl.title, cardWidth, titleFontSize);
      titleY = currentY;
      currentY += titleLines.length * lineHeight + 24;
    }
  } else {
    currentY = 0;
  }

  const videoBoxX = showHeader ? cardX : 0;
  const videoBoxY = showHeader ? currentY : 0;
  const videoBoxW = showHeader ? cardWidth : CW;
  let videoBoxH;
  if (!showHeader) videoBoxH = CH;
  else if (tpl.videoBoxAspect === "16:9") videoBoxH = Math.round(cardWidth * (9 / 16));
  else if (tpl.videoBoxAspect === "4:5") videoBoxH = Math.round(cardWidth * (5 / 4));
  else videoBoxH = cardWidth;

  drawVideoInBox(tpl, videoBoxX, videoBoxY, videoBoxW, videoBoxH);

  if (showHeader) {
    if (hasAvatar) {
      pctx.save();
      pctx.beginPath();
      pctx.arc((cardX + avatarSize / 2) * scaleF, (headerTop + avatarSize / 2) * scaleF, (avatarSize / 2) * scaleF, 0, Math.PI * 2);
      pctx.clip();
      pctx.drawImage(avatarImg, cardX * scaleF, headerTop * scaleF, avatarSize * scaleF, avatarSize * scaleF);
      pctx.restore();
    }

    if (tpl.name) {
      pctx.textBaseline = "top";
      pctx.font = `bold ${nameFontSize * scaleF}px sans-serif`;
      pctx.fillStyle = primary;
      pctx.fillText(tpl.name, infoX * scaleF, nameY * scaleF);

      if (tpl.verified) {
        const nameW = pctx.measureText(tpl.name).width;
        const bx = infoX * scaleF + nameW + 8 * scaleF;
        const by = nameY * scaleF + 13 * scaleF;
        const r = 13 * scaleF;
        pctx.beginPath();
        pctx.arc(bx + r, by, r, 0, Math.PI * 2);
        pctx.fillStyle = BADGE_HEX[tpl.verifiedColor] || BADGE_HEX.blue;
        pctx.fill();
        pctx.strokeStyle = "#fff";
        pctx.lineWidth = Math.max(1, 2.2 * scaleF);
        pctx.lineCap = "round";
        pctx.lineJoin = "round";
        pctx.beginPath();
        pctx.moveTo(bx + r * 0.55, by);
        pctx.lineTo(bx + r * 0.9, by + r * 0.35);
        pctx.lineTo(bx + r * 1.5, by - r * 0.35);
        pctx.stroke();
      }
    }

    if (tpl.handle) {
      pctx.font = `${handleFontSize * scaleF}px sans-serif`;
      pctx.globalAlpha = tpl.handleOpacity ?? 0.6;
      pctx.fillStyle = secondary;
      pctx.fillText("@" + tpl.handle, infoX * scaleF, handleY * scaleF);
      pctx.globalAlpha = 1;
    }

    if (titleLines.length) {
      pctx.font = `bold ${titleFontSize * scaleF}px sans-serif`;
      pctx.fillStyle = primary;
      titleLines.forEach((line, i) => {
        pctx.fillText(line, cardX * scaleF, (titleY + i * lineHeight) * scaleF);
      });
    }
  }
}

function scheduleDraw() {
  if (!previewVideo.videoWidth) drawPreview();
}

function loopDraw() {
  drawPreview();
  rafId = requestAnimationFrame(loopDraw);
}

previewVideo.addEventListener("loadedmetadata", () => scheduleDraw());

document.querySelectorAll("#tplName, #tplHandle, #tplTitle, #pageBackground, #videoBoxAspect, #overlayText, #invert, #verified, #verifiedColor, #zoomScale, #centerOffsetY, #topMargin").forEach((el) => {
  el.addEventListener("input", () => { if (!previewVideo.videoWidth) drawPreview(); });
});
drawPreview();

let dragStartX = null;
let dragStartY = null;
let dragStartOffset = 0;
let dragStartBoxX = 0;
let dragStartBoxY = 0;
let pinchStartDist = null;
let pinchStartZoom = 1;
let pinchStartBoxW = 0;
let pinchStartBoxH = 0;

function dist(t1, t2) {
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

previewCanvas.addEventListener("touchstart", (e) => {
  const useCustomBg = !!templateBgImg;
  if (e.touches.length === 2) {
    pinchStartDist = dist(e.touches[0], e.touches[1]);
    if (useCustomBg) {
      pinchStartBoxW = boxWPct;
      pinchStartBoxH = boxHPct;
    } else {
      pinchStartZoom = parseFloat($("zoomScale").value);
    }
    dragStartY = null;
  } else if (e.touches.length === 1) {
    dragStartX = e.touches[0].clientX;
    dragStartY = e.touches[0].clientY;
    if (useCustomBg) {
      dragStartBoxX = boxXPct;
      dragStartBoxY = boxYPct;
    } else {
      dragStartOffset = parseFloat($("centerOffsetY").value);
    }
  }
  e.preventDefault();
}, { passive: false });

previewCanvas.addEventListener("touchmove", (e) => {
  const useCustomBg = !!templateBgImg;
  if (e.touches.length === 2 && pinchStartDist) {
    const d = dist(e.touches[0], e.touches[1]);
    const factor = d / pinchStartDist;
    if (useCustomBg) {
      boxWPct = Math.max(10, Math.min(100, Math.round(pinchStartBoxW * factor)));
      boxHPct = Math.max(10, Math.min(100, Math.round(pinchStartBoxH * factor)));
    } else {
      let z = Math.min(1.8, Math.max(1, pinchStartZoom * factor));
      z = Math.round(z * 50) / 50;
      $("zoomScale").value = z;
    }
    drawPreview();
  } else if (e.touches.length === 1 && dragStartY !== null) {
    const deltaScreenY = e.touches[0].clientY - dragStartY;
    const deltaCanvasPxY = deltaScreenY * (previewCanvas.height / previewCanvas.clientHeight);
    if (useCustomBg) {
      const deltaScreenX = e.touches[0].clientX - dragStartX;
      const deltaCanvasPxX = deltaScreenX * (previewCanvas.width / previewCanvas.clientWidth);
      const deltaPctX = (deltaCanvasPxX / scaleF / CW) * 100;
      const deltaPctY = (deltaCanvasPxY / scaleF / CH) * 100;
      boxXPct = Math.max(0, Math.min(100 - boxWPct, dragStartBoxX + deltaPctX));
      boxYPct = Math.max(0, Math.min(100 - boxHPct, dragStartBoxY + deltaPctY));
    } else {
      const delta1080 = deltaCanvasPxY / scaleF;
      let off = Math.round((dragStartOffset - delta1080) / 5) * 5;
      off = Math.max(-300, Math.min(300, off));
      $("centerOffsetY").value = off;
    }
    drawPreview();
  }
  e.preventDefault();
}, { passive: false });

previewCanvas.addEventListener("touchend", () => {
  dragStartX = null;
  dragStartY = null;
  pinchStartDist = null;
});

$("exportTpl").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(currentTemplate(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "escalax-template.json";
  a.click();
});

$("importTpl").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const tpl = JSON.parse(await file.text());
  $("overlayText").checked = !!tpl.overlayText;
  $("invert").checked = !!tpl.invert;
  $("tplName").value = tpl.name || "";
  $("tplHandle").value = tpl.handle || "";
  $("tplTitle").value = tpl.title || "";
  $("pageBackground").value = tpl.pageBackground || "black";
  $("videoBoxAspect").value = tpl.videoBoxAspect || "1:1";
  $("verified").checked = !!tpl.verified;
  $("verifiedColor").value = tpl.verifiedColor || "blue";
  $("zoomScale").value = tpl.zoomScale ?? 1;
  $("centerOffsetY").value = tpl.centerOffsetY ?? 0;
  $("topMargin").value = tpl.topMargin ?? 130;
  boxXPct = tpl.boxXPct ?? 5;
  boxYPct = tpl.boxYPct ?? 40;
  boxWPct = tpl.boxWPct ?? 90;
  boxHPct = tpl.boxHPct ?? 45;
  if (tpl.watermark) {
    $("wmEnabled").checked = !!tpl.watermark.enabled;
    $("wmPosition").value = tpl.watermark.position || "bottom-right";
    $("wmOpacity").value = tpl.watermark.opacity ?? 0.6;
  }
  drawPreview();
});

$("processBtn").addEventListener("click", async () => {
  $("processBtn").disabled = true;
  try {
    state.logoKey = await uploadAsset("logoFile");
    state.wmKey = await uploadAsset("wmFile");
    state.templateBgKey = await uploadAsset("templateBgFile");

    await runWithLimit(
      state.files.map((item) => async () => {
        if (item.status === "error") return;
        item.status = "uploading";
        try {
          const key = await presignAndUpload(item.file, (pct) =>
            setItemProgress(item, Math.round(pct * 0.5), `Enviando ${pct}%`)
          );
          item.uploadKey = key;
          item.status = "uploaded";
          setItemProgress(item, 50, "Enviado, na fila...");
        } catch (err) {
          setItemError(item, err.message);
        }
      }),
      4
    );

    const ready = state.files.filter((f) => f.uploadKey);
    if (!ready.length) throw new Error("nenhum vídeo foi enviado com sucesso");

    const r = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videos: ready.map((f) => ({ key: f.uploadKey, filename: f.file.name })),
        template: currentTemplate(),
        logoKey: state.logoKey,
        watermarkKey: state.wmKey,
        templateBgKey: state.templateBgKey,
      }),
    });
    if (!r.ok) throw new Error("falha ao criar os jobs de processamento");
    const { jobIds } = await r.json();
    ready.forEach((f, i) => (f.jobId = jobIds[i]));

    pollJobs();
  } catch (err) {
    alert("Erro: " + err.message);
    $("processBtn").disabled = false;
  }
});

function pollJobs() {
  const interval = setInterval(async () => {
    const withJob = state.files.filter((f) => f.jobId && f.status !== "done" && f.status !== "error");
    if (!withJob.length) {
      clearInterval(interval);
      checkAllDone();
      return;
    }
    const r = await fetch("/api/jobs/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: withJob.map((f) => f.jobId) }),
    });
    const statuses = await r.json();
    statuses.forEach((s) => {
      const item = state.files.find((f) => f.jobId === s.id);
      if (!item) return;
      if (s.status === "error") {
        setItemError(item, s.error || "erro no processamento");
      } else if (s.status === "done") {
        item.status = "done";
        setItemProgress(item, 100, "Concluído");
        fetch(`/api/jobs/${s.id}/download`)
          .then((r) => r.json())
          .then(({ url }) => {
            const link = item.el.querySelector(".link");
            link.innerHTML = `<a href="${url}" target="_blank">baixar</a>`;
          });
      } else {
        const pct = 50 + Math.round((s.percent || 0) * 0.5);
        setItemProgress(item, pct, labelFor(s.status));
      }
    });
    checkAllDone();
  }, 2000);
}

function labelFor(status) {
  return { downloading: "Baixando...", processing: "Processando...", uploading: "Salvando..." }[status] || status;
}

function checkAllDone() {
  const allDone = state.files.length && state.files.every((f) => f.status === "done" || f.status === "error");
  $("zipBtn").disabled = !state.files.some((f) => f.status === "done");
  if (allDone) $("processBtn").disabled = false;
}

$("zipBtn").addEventListener("click", async () => {
  const ids = state.files.filter((f) => f.status === "done").map((f) => f.jobId);
  const r = await fetch("/api/export/zip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!r.ok) {
    alert("Erro ao gerar o zip");
    return;
  }
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "escalax-export.zip";
  a.click();
});
