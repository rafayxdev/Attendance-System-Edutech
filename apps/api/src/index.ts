import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { deleteOldAttendanceImages } from "./lib/attendance-images.js";

const app = createApp();

async function runAttendanceImageCleanup() {
  try {
    const removed = await deleteOldAttendanceImages();
    if (removed > 0) {
      console.log(`Removed image data from ${removed} old attendance logs.`);
    }
  } catch (error) {
    console.error("Failed to clean up old attendance images.", error);
  }
}

void runAttendanceImageCleanup();
setInterval(
  () => {
    void runAttendanceImageCleanup();
  },
  24 * 60 * 60 * 1000,
);

app.listen(env.port, () => {
  console.log(`EduTech API listening on port ${env.port}`);
});
