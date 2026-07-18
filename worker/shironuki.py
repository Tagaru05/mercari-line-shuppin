# 白抜きレシピ v2（Codexレビュー反映：複数成分保持・EXIF回転・日本語エラー）
# 使い方: venv/bin/python shironuki.py 入力.jpg 出力.jpg
import argparse
import sys

def main():
    ap = argparse.ArgumentParser(description="商品写真の背景を白抜きにします")
    ap.add_argument("src", help="入力画像（jpg/png）")
    ap.add_argument("dst", help="出力先（jpg）")
    ap.add_argument("--keep-ratio", type=float, default=0.08,
                    help="最大パーツに対しこの面積比以上の部分を残す（靴の左右・セット品対策。既定0.08）")
    args = ap.parse_args()

    try:
        import numpy as np
        from PIL import Image, ImageOps
        from scipy import ndimage
        from rembg import remove, new_session
    except ImportError as e:
        print(f"❌ 必要な部品が入っていません: {e}\n→ venvに rembg onnxruntime scipy pillow numpy を入れてください")
        sys.exit(1)

    try:
        img = Image.open(args.src)
    except FileNotFoundError:
        print(f"❌ ファイルが見つかりません: {args.src}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 画像として開けませんでした: {e}")
        sys.exit(1)

    img = ImageOps.exif_transpose(img)  # スマホ写真の回転情報を反映
    if img.width * img.height > 40_000_000:
        print("❌ 画像が大きすぎます（4000万画素超）。縮小してから渡してください")
        sys.exit(1)

    session = new_session("isnet-general-use")
    cut = remove(img, session=session, alpha_matting=True,
                 alpha_matting_foreground_threshold=240,
                 alpha_matting_background_threshold=15,
                 alpha_matting_erode_size=10)
    a = np.array(cut)
    alpha = a[:, :, 3]
    mask = alpha > 60
    labels, n = ndimage.label(mask)
    removed = 0
    if n > 1:
        # 最大パーツ基準の面積比で複数パーツを保持（靴の左右・付属品・セット品を消さない）
        sizes = ndimage.sum(mask, labels, range(1, n + 1))
        biggest = sizes.max()
        keep = {i + 1 for i, s in enumerate(sizes) if s >= biggest * args.keep_ratio}
        keep_mask = np.isin(labels, list(keep))
        removed = n - len(keep)
        a[:, :, 3] = np.where(keep_mask, alpha, 0)

    cut2 = Image.fromarray(a)
    white = Image.new("RGB", cut2.size, (255, 255, 255))
    white.paste(cut2, mask=cut2.split()[3])
    white.save(args.dst, quality=92)
    print(f"✅ 白抜き完了: {args.dst}（パーツ{n}個中、背景の島{removed}個を除去）")
    print("⚠️ 必ず元写真と見比べて、商品の一部（付属品・左右セット等）が消えていないか確認してください")

if __name__ == "__main__":
    main()
