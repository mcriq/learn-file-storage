import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { Buffer } from "buffer";
import path from "path";
import { getAssetDiskPath, getAssetURL, mediaTypeToExt } from "./assets";

const MAX_UPLOAD_SIZE = 10 << 20;

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Video not found");
  }

  if (userID !== video.userID) {
    throw new UserForbiddenError("Not authorized to update this video");
  }

  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File exceeds max upload size");
  }

  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }

  const ext = mediaTypeToExt(mediaType);

  const fileName = `${video.id}${ext}`;
  const assetDiskPath = getAssetDiskPath(cfg, fileName);

  await Bun.write(assetDiskPath, file);

  const urlPath = getAssetURL(cfg, fileName);
  video.thumbnailURL = urlPath;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, null);
}
