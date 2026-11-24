// Local animation for the full-screen Album Slideshow camera background.
(() => {
  const sessions = new WeakMap();
  const poses = [
    "translate(-0.6%, 0.5%) scale(1.025)",
    "translate(2%, -1.5%) scale(1.14)",
  ];

  function supports(settings, attrs) {
    return settings.kenBurns !== false && attrs && attrs.frame_id != null &&
      Array.isArray(attrs.displayed_photo_ids);
  }

  function stop(overlay) {
    const s = sessions.get(overlay);
    if (!s) return;
    sessions.delete(overlay);
    s.motion?.cancel();
    s.fade?.cancel();
    s.previous?.remove();
  }

  function update(overlay, settings, state, hass) {
    const attrs = state?.attributes;
    if (!supports(settings, attrs)) {
      stop(overlay);
      return false;
    }
    let s = sessions.get(overlay);
    if (!s) {
      s = { sequence: 0, heartbeat: 0 };
      sessions.set(overlay, s);
    }
    if (attrs.pause_when_unwatched && attrs.entry_id && Date.now() >= s.heartbeat) {
      s.heartbeat = Date.now() + 20000;
      hass.callWS({ type: "album_slideshow/viewer_heartbeat", entry_id: attrs.entry_id }).catch(() => {});
    }
    const accessibility = window.__familyHubEink;
    const still = accessibility?.a11y().reduceMotion || (accessibility && accessibility.deviceMode() !== "off") ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    s.paused = !!(attrs.paused || still);
    if (s.motion) {
      if (s.paused && s.motion.playState === "running") s.motion.pause();
      if (!s.paused && s.motion.playState === "paused") s.motion.play();
    }

    // Access tokens and cache-busting URLs can change while the same photo is up.
    const photos = attrs.displayed_photo_ids;
    const key = JSON.stringify([settings.cameraEntity, photos.some(Boolean) ? photos : attrs.frame_id]);
    s.wanted = key;
    if (key === s.key || key === s.pending) return true;
    s.pending = key;
    const next = new Image();
    next.alt = "";
    const url = new URL(attrs.entity_picture, document.baseURI);
    url.searchParams.set("fhts", Date.now());
    next.src = url.href;

    next.decode().then(() => {
      if (sessions.get(overlay) !== s || !overlay.isConnected || s.wanted !== key) return;
      const old = overlay.querySelector(".screensaver-camera-image");
      if (!old) return;
      s.fade?.cancel();
      s.previous?.remove();
      const previousMotion = s.motion;
      // Keep the outgoing photo at its current crop during the dissolve.
      previousMotion?.pause();
      old.classList.remove("screensaver-camera-image");
      next.className = "screensaver-camera-image";
      Object.assign(next.style, {
        position: "absolute", inset: "0", width: "100%", height: "100%",
        objectFit: "cover", background: "#000", pointerEvents: "none",
      });
      overlay.style.overflow = "hidden";
      old.after(next);
      const path = s.sequence++ % 2 ? [...poses].reverse() : poses;
      const duration = Math.max(1000, (Number(attrs.slide_interval) || 60) * 1000);
      s.motion = next.animate(path.map(transform => ({ transform })), {
        duration, easing: "ease-in-out", fill: "both",
      });
      if (s.paused) s.motion.pause();
      s.previous = old;
      if (s.key && !still) {
        const fade = next.animate([{ opacity: 0 }, { opacity: 1 }], 700);
        s.fade = fade;
        fade.finished.then(() => {
          old.remove();
          previousMotion?.cancel();
          if (s.previous === old) s.previous = null;
        }, () => {});
      } else {
        old.remove();
        previousMotion?.cancel();
        s.previous = null;
      }
      s.key = key;
    }).catch(() => {
      // Keep the visible photo and retry on the next poll.
    }).finally(() => {
      if (s.pending === key) s.pending = null;
    });
    return true;
  }

  window.FamilyHubPhotoMotion = { supports, update, stop };
})();
