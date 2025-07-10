// src/yt_player.js
let playerReadyResolve;
export const playerReady = new Promise((resolve) => {
  playerReadyResolve = resolve;
});

export function initYoutubePlayer() {
  const playerContainer = document.createElement('div');
  playerContainer.id = 'youtube-player';
  playerContainer.style.position = 'absolute';
  playerContainer.style.bottom = '10px';
  playerContainer.style.left = '10px';
  playerContainer.style.width = '360px';
  playerContainer.style.height = '200px';
  playerContainer.style.zIndex = '10';
  document.body.appendChild(playerContainer);

  const tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  document.body.appendChild(tag);

  window.onYouTubeIframeAPIReady = () => {
    const player = new YT.Player('youtube-player', {
      height: '200',
      width: '360',
      videoId: '',
      events: {
        onReady: () => {
          console.log("✅ YouTube Player prêt");
          playerReadyResolve(player); // Résout la promesse avec l’instance
        }
      }
    });
  };
}
