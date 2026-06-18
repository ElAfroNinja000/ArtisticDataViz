// src/yt_player.js
let playerReadyResolve;
export const playerReady = new Promise((resolve) => {
  playerReadyResolve = resolve;
});

export function initYoutubePlayer() {
  // Wrapper porte le style responsive ; YT.Player remplace la div interne par
  // l'iframe (à 100% du wrapper), donc le style ne doit pas vivre sur la div remplacée.
  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.bottom = '10px';
  wrapper.style.left = '10px';
  wrapper.style.width = 'min(360px, 90vw)';
  wrapper.style.aspectRatio = '16 / 9';
  wrapper.style.zIndex = '10';

  const inner = document.createElement('div');
  inner.id = 'youtube-player';
  wrapper.appendChild(inner);
  document.body.appendChild(wrapper);

  const tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  document.body.appendChild(tag);

  window.onYouTubeIframeAPIReady = () => {
    const player = new YT.Player('youtube-player', {
      height: '100%',
      width: '100%',
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
