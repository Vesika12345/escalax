const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require("fs");

const BUCKET = process.env.R2_BUCKET;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function presignUpload(key, contentType) {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: 60 * 15 });
}

async function presignDownload(key, filename) {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: filename
      ? `attachment; filename="${filename}"`
      : undefined,
  });
  return getSignedUrl(s3, cmd, { expiresIn: 60 * 60 });
}

async function downloadToFile(key, destPath) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const res = await s3.send(cmd);
  await new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(destPath);
    res.Body.pipe(writeStream);
    res.Body.on("error", reject);
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });
}

async function uploadFromFile(key, srcPath, contentType) {
  const body = fs.createReadStream(srcPath);
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType || "video/mp4",
  });
  await s3.send(cmd);
}

async function deleteObject(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = {
  s3,
  BUCKET,
  presignUpload,
  presignDownload,
  downloadToFile,
  uploadFromFile,
  deleteObject,
};
