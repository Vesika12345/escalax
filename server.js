try { require("dotenv").config(); } catch (_) {}
const express = require("express");
const cors = require("cors");
const { nanoid } = require("nanoid");
const archiver = require("archiver");
const { Readable } = require("node:stream");

const { presignUpload, presignDownload } = require("./src/r2");
const { createJob, getJob, jobDownloadUrl } = require("./src/queue");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// 1) o front pede uma URL assinada e sobe o arquivo DIRETO pro R2 (progress real de upload)
app.post("/api/presign-upload", async (req, res) => {
  try {
    const { filename, contentType } = req.body;
    const key = `uploads/${nanoid(10)}-${filename}`;
    const url = await presignUpload(key, contentType || "video/mp4");
    res.json({ key, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2) cria os jobs de processamento em massa (um por vídeo)
app.post("/api/jobs", (req, res) => {
  try {
    const { videos, template, logoKey, watermarkKey, templateBgKey } = req.body;
    // videos: [{ key, filename }]
    const jobIds = videos.map((v) =>
      createJob({
        sourceKey: v.key,
        filename: v.filename,
        template: template || {},
        logoKey,
        watermarkKey,
        templateBgKey,
      })
    );
    res.json({ jobIds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3) status de um job (usado pra barra de progresso)
app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job não encontrado" });
  res.json(job);
});

// 4) status de vários jobs de uma vez
app.post("/api/jobs/status", (req, res) => {
  const { ids } = req.body;
  const result = ids.map((id) => getJob(id)).filter(Boolean);
  res.json(result);
});

// 5) baixar um único vídeo processado
app.get("/api/jobs/:id/download", async (req, res) => {
  const url = await jobDownloadUrl(req.params.id);
  if (!url) return res.status(404).json({ error: "ainda não está pronto" });
  res.json({ url });
});

// 6) exportar em massa: zip com todos os vídeos prontos
app.post("/api/export/zip", async (req, res) => {
  try {
    const { ids } = req.body;
    const jobs = ids.map((id) => getJob(id)).filter((j) => j && j.status === "done");
    if (!jobs.length) return res.status(400).json({ error: "nenhum vídeo pronto pra exportar" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="escalax-export.zip"`);

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.pipe(res);

    for (const job of jobs) {
      const url = await presignDownload(job.outputKey, job.filename);
      const fetchRes = await fetch(url);
      archive.append(Readable.fromWeb(fetchRes.body), { name: job.filename });
    }

    await archive.finalize();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`escalaX rodando na porta ${PORT}`));
