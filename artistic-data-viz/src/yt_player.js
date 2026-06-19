// src/yt_player.js
let playerReadyResolve;
export const playerReady = new Promise((resolve) => {
  playerReadyResolve = resolve;
});

export function initYoutubePlayer() {
  // Le lecteur joue l'audio mais reste invisible : on affiche à la place un bandeau
  // "en lecture" custom (cf. main.js). On garde l'iframe rendue (1x1, opacity 0) plutôt
  // que display:none, car masquer complètement couperait l'audio sur certains navigateurs.
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.bottom = '0';
  wrapper.style.width = '1px';
  wrapper.style.height = '1px';
  wrapper.style.opacity = '0';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.zIndex = '-1';

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
