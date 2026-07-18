/**
 * LINE写真受付Webhook（メルカリ出品ライン）v0.3
 * 2026-07-18 Codex独立レビュー反映版
 *
 * 主な安全設計：
 * - ALLOWED_USER未登録の間は写真を一切保存しない（fail-closed）＋登録フロー内蔵
 * - 認証はAuthorizationヘッダー（Bearer LIST_KEY）。URLクエリにキーを載せない
 * - 外部（ChatGPT等）へ渡す画像は期限付き署名URL（マスターキー非露出）
 * - webhookEventIdで再配送を重複排除／保存はTTL付き（box=30日・done=7日）
 */

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacB64(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function authed(request, env) {
  const h = request.headers.get("authorization") || "";
  return env.LIST_KEY && h === `Bearer ${env.LIST_KEY}`;
}

const TTL_BOX = 60 * 60 * 24 * 30;   // 未処理30日
const TTL_DONE = 60 * 60 * 24 * 7;   // 処理済み7日で自動削除
const TTL_EVENT = 60 * 60;           // 重複排除記録1時間
const TTL_ENROLL = 60 * 60;          // 登録候補1時間

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/") {
      const enrolled = !!env.ALLOWED_USER;
      return new Response(`line-mercari-uketsuke v0.3 稼働中（持ち主登録: ${enrolled ? "済" : "未・写真は保存されません"}）`);
    }

    // ---- 認証必須ゾーン（Authorization: Bearer <LIST_KEY>）----

    if (request.method === "GET" && path === "/list") {
      if (!authed(request, env)) return new Response("forbidden", { status: 403 });
      const list = await env.UKETSUKE.list({ prefix: "box/", limit: 200 });
      return Response.json({ keys: list.keys.map(k => k.name), truncated: !list.list_complete });
    }

    if (request.method === "GET" && path.startsWith("/get/")) {
      if (!authed(request, env)) return new Response("forbidden", { status: 403 });
      const k = decodeURIComponent(path.slice(5));
      const v = await env.UKETSUKE.get(k, { type: "arrayBuffer" });
      if (!v) return new Response("not found", { status: 404 });
      const ct = k.endsWith(".txt") ? "text/plain; charset=utf-8" : "image/jpeg";
      return new Response(v, { headers: { "content-type": ct } });
    }

    // 期限付き署名URLの発行（ChatGPT等へ渡す用。マスターキーを出さない）
    if (request.method === "GET" && path === "/sign") {
      if (!authed(request, env)) return new Response("forbidden", { status: 403 });
      const k = url.searchParams.get("key") || "";
      const ttl = Math.min(parseInt(url.searchParams.get("ttl") || "600", 10), 3600);
      const exp = Math.floor(Date.now() / 1000) + ttl;
      const sig = await hmacHex(env.LIST_KEY, `${k}|${exp}`);
      return Response.json({ url: `${url.origin}/public/${encodeURIComponent(k)}?exp=${exp}&sig=${sig}` });
    }

    // 署名付き公開取得（キー不要・期限付き・CORSあり）
    if (request.method === "GET" && path.startsWith("/public/")) {
      const k = decodeURIComponent(path.slice(8));
      const exp = parseInt(url.searchParams.get("exp") || "0", 10);
      const sig = url.searchParams.get("sig") || "";
      if (!env.LIST_KEY || exp < Date.now() / 1000) return new Response("expired", { status: 403 });
      const expect = await hmacHex(env.LIST_KEY, `${k}|${exp}`);
      if (sig !== expect) return new Response("bad signature", { status: 403 });
      const v = await env.UKETSUKE.get(k, { type: "arrayBuffer" });
      if (!v) return new Response("not found", { status: 404 });
      return new Response(v, { headers: { "content-type": "image/jpeg", "access-control-allow-origin": "*" } });
    }

    // 作業ファイルのアップロード（work/ 限定）
    if (request.method === "PUT" && path.startsWith("/upload/")) {
      if (!authed(request, env)) return new Response("forbidden", { status: 403 });
      const k = decodeURIComponent(path.slice(8));
      if (!k.startsWith("work/") || k.length > 200) return new Response("key must start with work/", { status: 400 });
      const body = await request.arrayBuffer();
      if (body.byteLength > 10 * 1024 * 1024) return new Response("too large", { status: 413 });
      await env.UKETSUKE.put(k, body, { expirationTtl: TTL_DONE });
      return Response.json({ ok: true, key: k, bytes: body.byteLength });
    }

    // 持ち主へのLINE push通知（完了報告用）
    if (request.method === "POST" && path === "/notify") {
      if (!authed(request, env)) return new Response("forbidden", { status: 403 });
      if (!env.ALLOWED_USER) return new Response("no allowed user", { status: 409 });
      let text;
      try { text = String((await request.json()).text || "").slice(0, 4900); }
      catch { return new Response("bad json", { status: 400 }); }
      if (!text) return new Response("text required", { status: 400 });
      const r = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
        body: JSON.stringify({ to: env.ALLOWED_USER, messages: [{ type: "text", text }] }),
      });
      return Response.json({ ok: r.ok, status: r.status });
    }

    // 登録候補の確認（セットアップ時に1回だけ使う）
    if (request.method === "GET" && path === "/enroll") {
      if (!authed(request, env)) return new Response("forbidden", { status: 403 });
      const uid = await env.UKETSUKE.get("meta/last_user");
      return Response.json({ userId: uid || null, hint: uid ? "wrangler secret put ALLOWED_USER にこの値を設定" : "先にLINEへ写真かメッセージを送ってください" });
    }

    // 処理済み移動（box/ のみ・検証つき）
    if (request.method === "POST" && path === "/done") {
      if (!authed(request, env)) return new Response("forbidden", { status: 403 });
      let keys;
      try { keys = (await request.json()).keys; }
      catch { return new Response("bad json", { status: 400 }); }
      if (!Array.isArray(keys) || keys.length === 0 || keys.length > 50) {
        return new Response("keys must be array (1-50)", { status: 400 });
      }
      let moved = 0;
      for (const k of keys) {
        if (typeof k !== "string" || !k.startsWith("box/") || k.length > 200) continue;
        const v = await env.UKETSUKE.get(k, { type: "arrayBuffer" });
        if (v) {
          await env.UKETSUKE.put(k.replace(/^box\//, "done/"), v, { expirationTtl: TTL_DONE });
          await env.UKETSUKE.delete(k);
          moved++;
        }
      }
      return Response.json({ moved });
    }

    if (request.method !== "POST" || path !== "/webhook") {
      return new Response("not found", { status: 404 });
    }

    // ---- LINE Webhook ----

    const body = await request.text();

    // 署名検証（必須。secret未設定なら受け付けない）
    if (!env.LINE_CHANNEL_SECRET) return new Response("channel secret not configured", { status: 403 });
    const expected = await hmacB64(env.LINE_CHANNEL_SECRET, body);
    if (request.headers.get("x-line-signature") !== expected) {
      return new Response("bad signature", { status: 403 });
    }

    const data = JSON.parse(body);
    const events = data.events || [];
    let savedImages = 0, savedTexts = 0, replyToken = null, setupMode = false;

    for (const ev of events) {
      if (ev.type !== "message") continue;

      // 再配送の重複排除（LINEは同一webhookを複数回送ることがある）
      if (ev.webhookEventId) {
        const seen = await env.UKETSUKE.get(`meta/ev_${ev.webhookEventId}`);
        if (seen) continue;
        await env.UKETSUKE.put(`meta/ev_${ev.webhookEventId}`, "1", { expirationTtl: TTL_EVENT });
      }

      const uidFull = ev.source && ev.source.userId ? ev.source.userId : "";

      // 持ち主未登録＝保存しない（fail-closed）。登録候補だけ記録
      if (!env.ALLOWED_USER) {
        if (uidFull) await env.UKETSUKE.put("meta/last_user", uidFull, { expirationTtl: TTL_ENROLL });
        replyToken = ev.replyToken;
        setupMode = true;
        continue;
      }
      // 持ち主以外は無視
      if (uidFull !== env.ALLOWED_USER) continue;

      replyToken = ev.replyToken;
      const ts = new Date(ev.timestamp).toISOString().replace(/[:.]/g, "-");
      const uid = uidFull.slice(-8);

      if (ev.message.type === "image") {
        const res = await fetch(`https://api-data.line.me/v2/bot/message/${ev.message.id}/content`, {
          headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
        });
        if (res.ok) {
          await env.UKETSUKE.put(`box/${ts}_${uid}_${ev.message.id}.jpg`, await res.arrayBuffer(), { expirationTtl: TTL_BOX });
          savedImages++;
        }
      } else if (ev.message.type === "text") {
        await env.UKETSUKE.put(`box/${ts}_${uid}_memo.txt`, ev.message.text, { expirationTtl: TTL_BOX });
        savedTexts++;
      }
    }

    // 返信（reply APIは無料）
    if (replyToken) {
      let text = null;
      if (setupMode) {
        text = "🔧 ただいまセットアップ中です。メッセージは保存されていません。（持ち主登録が終わると使えるようになります）";
      } else if (savedImages > 0 || savedTexts > 0) {
        const parts = [];
        if (savedImages > 0) parts.push(`写真${savedImages}枚`);
        if (savedTexts > 0) parts.push(`メモ${savedTexts}件`);
        text = `📦 ${parts.join("と")}を受け取りました。\nこのままメルカリの下書きまで自動で準備します。完了したらお知らせします。`;
      }
      if (text) {
        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
          body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
        });
      }
    }

    return new Response("ok");
  },
};
