const state = {
  files: [],
  logoKey: null,
  wmKey: null,
};

const $ = (id) => document.getElementById(id);
const list = $("list");

function addFiles(fileList) {
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
    watermark: {
      enabled: $("wmEnabled").checked,
      position: $("wmPosition").value,
      opacity: parseFloat($("wmOpacity").value),
    },
  };
}

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
  if (tpl.watermark) {
    $("wmEnabled").checked = !!tpl.watermark.enabled;
    $("wmPosition").value = tpl.watermark.position || "bottom-right";
    $("wmOpacity").value = tpl.watermark.opacity ?? 0.6;
  }
});

$("processBtn").addEventListener("click", async () => {
  $("processBtn").disabled = true;
  try {
    state.logoKey = await uploadAsset("logoFile");
    state.wmKey = await uploadAsset("wmFile");

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
