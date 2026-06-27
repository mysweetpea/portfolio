export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Matrix federation well-known
    if (url.pathname === '/.well-known/matrix/server') {
      return new Response(JSON.stringify({
        "m.server": "matrix.mysweetpea.cc:443"
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/.well-known/matrix/client') {
      return new Response(JSON.stringify({
        "m.homeserver": { "base_url": "https://matrix.mysweetpea.cc" }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Default: serve static site
    return env.ASSETS.fetch(request);
  }
};
