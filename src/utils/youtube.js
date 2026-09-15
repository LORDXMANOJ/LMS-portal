// Extracts a YouTube video id from any common URL shape a faculty member
// might paste, or returns null if the string doesn't look like one.
function extractYoutubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const match = url.match(re);
    if (match) return match[1];
  }
  return null;
}

// youtube-nocookie.com avoids setting tracking cookies until the viewer
// actually presses play.
function youtubeEmbedUrl(videoId) {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

module.exports = { extractYoutubeId, youtubeEmbedUrl };
