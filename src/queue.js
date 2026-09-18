const fs = require("fs");
const path = require("path");
const os = require("os");
const pLimit = require("p-limit");
const { nanoid } = require("nanoid");
const { downloadToFile, uploadFromFile, presignDownload } = require("./r2");
const { processVideo } = require("./ffmpeg");

const limit = pLimit(parseInt(process.env.MAX_CONCURRENT_JOBS || "2", 10));
const TMP_DIR = process.env.TMP_DIR || os.tmpdir();

const jobs = new Map();

function createJob({ sourceKey, filename, template, logoKey, watermarkKey }) {
  const id = nanoid(10);
  jobs.set(id, {
    id,
    status: "queued",
    percent: 0,
    error: null,
    outputKey: null,
    filename,
  });

  limit(() => runJob(id, { sourceKey, filename, template, logoKey, watermarkKey })).catch(() => {});

  return id;
}

async function runJob(id, { sourceKey, filename, template, logoKey, watermarkKey }) {
  const job = jobs.get(id);
  const workDir = path.join(TMP_DIR, id);
  fs.mkdirSync(workDir, { recursive: true });

  const inputPath = path.join(workDir, "input.mp4");
  const outputPath = path.join(workDir, "output.mp4");
  const logoPath = logoKey ? path.join(workDir, "logo.png") : null;
  const wmPath = watermarkKey ? path.join(workDir, "watermark.png") : null;

  try {
    job.status = "downloading";
    await downloadToFile(sourceKey, inputPath);
    if (logoKey) await downloadToFile(logoKey, logoPath);
    if (watermarkKey) await downloadToFile(watermarkKey, wmPath);

    job.status = "processing";
    await processVideo({
      inputVideo: inputPath,
      logoPath,
      watermarkPath: wmPath,
      template,
      outputPath,
      onProgress: (percent) => {
        job.percent = Math.min(99, Math.round(percent));
      },
    });

    job.status = "uploading";
    const outputKey = `processed/${id}-${filename}`;
    await uploadFromFile(outputKey, outputPath, "video/mp4");

    job.outputKey = outputKey;
    job.percent = 100;
    job.status = "done";
  } catch (err) {
    job.status = "error";
    job.error = err.message || String(err);
  } finally {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  }
}

function getJob(id) {
  return jobs.get(id) || null;
}

async function jobDownloadUrl(id) {
  const job = jobs.get(id);
  if (!job || job.status !== "done") return null;
  return presignDownload(job.outputKey, job.filename);
}

module.exports = { createJob, getJob, jobDownloadUrl, jobs };
