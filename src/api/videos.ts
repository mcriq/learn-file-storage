import { rm } from "fs/promises";
import path from "path";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { respondWithJSON } from "./json";
import { uploadVideoToS3 } from "../s3";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  try {
    console.log("Starting video upload....");
    const MAX_UPLOAD_SIZE = 1 << 30;

    const { videoId } = req.params as { videoId?: string };
    console.log("Video ID:", videoId);
    if (!videoId) {
      throw new BadRequestError("Invalid video ID");
    }

    console.log("Getting bearer token...");
    const token = getBearerToken(req.headers);
    const userID = validateJWT(token, cfg.jwtSecret);

    console.log("Getting video from database...");
    const video = getVideo(cfg.db, videoId);
    console.log("Video found:", video);
    if (!video) {
      throw new NotFoundError("Couldn't find video");
    }
    if (video.userID !== userID) {
      throw new UserForbiddenError("Not authorized to update this video");
    }

    console.log("Processing form data...");
    const formData = await req.formData();
    const file = formData.get("video");
    console.log("File:", file);
    if (!(file instanceof File)) {
      throw new BadRequestError("Video file missing");
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      throw new BadRequestError("File exceeds size limit (1GB)");
    }
    if (file.type !== "video/mp4") {
      throw new BadRequestError("Invalid file type, only MP4 is allowed");
    }

    const tempFilePath = path.join("/tmp", `${videoId}.mp4`);
    await Bun.write(tempFilePath, file);

    let key = `${videoId}.mp4`;
    await uploadVideoToS3(cfg, key, tempFilePath, "video/mp4");

    const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
    video.videoURL = videoURL;
    updateVideo(cfg.db, video);

    await Promise.all([rm(tempFilePath, { force: true })]);

    return respondWithJSON(200, video);
  } catch (err) {
    console.error("Upload error:", err);
    throw err;
  }
}
