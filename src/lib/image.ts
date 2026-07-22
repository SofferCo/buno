export function readDataURL(file) { return new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); }); }

export function resizeImage(file, max, mime, q) {
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => {
      let { width, height } = img;
      if (width >= height && width > max) { height = Math.round(height * max / width); width = max; }
      else if (height > width && height > max) { width = Math.round(width * max / height); height = max; }
      const c = document.createElement("canvas"); c.width = width; c.height = height;
      c.getContext("2d").drawImage(img, 0, 0, width, height); resolve(c.toDataURL(mime, q));
    }; img.onerror = reject; img.src = fr.result as string; };
    fr.onerror = reject; fr.readAsDataURL(file);
  });
}
