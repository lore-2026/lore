#!/usr/bin/env node
/**
 * TMDB CLI — query the TMDB API from the command line or from Claude.
 *
 * Usage:
 *   node scripts/tmdb.js search "Inception"
 *   node scripts/tmdb.js movie 27205
 *   node scripts/tmdb.js tv 1396
 *   node scripts/tmdb.js trending
 *   node scripts/tmdb.js popular
 */

const BASE = 'https://api.themoviedb.org/3';

// Load token from .env.local
const fs = require('fs');
const envPath = require('path').resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && !process.env[key.trim()]) process.env[key.trim()] = rest.join('=').trim();
  }
}

const TOKEN = process.env.TMDB_TOKEN;
if (!TOKEN) {
  console.error('Error: TMDB_TOKEN not set. Add TMDB_TOKEN=<your-read-access-token> to .env.local');
  process.exit(1);
}

async function get(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${await res.text()}`);
  return res.json();
}

function year(dateStr) {
  return dateStr?.slice(0, 4) ?? null;
}

function formatMovie(m) {
  return {
    id: m.id,
    type: 'movie',
    title: m.title ?? m.name,
    year: year(m.release_date ?? m.first_air_date),
    overview: m.overview,
    posterPath: m.poster_path,
    genres: m.genres?.map(g => g.name) ?? [],
    runtime: m.runtime ?? null,
    cast: m.credits?.cast?.slice(0, 10).map(c => ({ name: c.name, character: c.character })) ?? [],
    keywords: m.keywords?.keywords?.map(k => k.name) ?? [],
  };
}

function formatTV(s) {
  return {
    id: s.id,
    type: 'tv',
    title: s.name ?? s.title,
    year: year(s.first_air_date),
    overview: s.overview,
    posterPath: s.poster_path,
    genres: s.genres?.map(g => g.name) ?? [],
    numberOfSeasons: s.number_of_seasons ?? null,
    seasons: s.seasons
      ?.filter(s => s.season_number > 0)
      .map(s => ({ season: s.season_number, name: s.name, episodes: s.episode_count })) ?? [],
    cast: s.credits?.cast?.slice(0, 10).map(c => ({ name: c.name, character: c.character })) ?? [],
    keywords: s.keywords?.results?.map(k => k.name) ?? [],
  };
}

function formatSearchResult(r) {
  return {
    id: r.id,
    type: r.media_type,
    title: r.title ?? r.name,
    year: year(r.release_date ?? r.first_air_date),
    overview: r.overview,
    posterPath: r.poster_path,
    genreIds: r.genre_ids ?? [],
  };
}

const commands = {
  async search(query) {
    const data = await get('/search/multi', { query, include_adult: 'false' });
    return data.results
      .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
      .slice(0, 10)
      .map(formatSearchResult);
  },

  async movie(id) {
    const data = await get(`/movie/${id}`, { append_to_response: 'credits,keywords' });
    return formatMovie(data);
  },

  async tv(id) {
    const data = await get(`/tv/${id}`, { append_to_response: 'credits,keywords' });
    return formatTV(data);
  },

  async trending() {
    const [movies, shows] = await Promise.all([
      get('/trending/movie/week'),
      get('/trending/tv/week'),
    ]);
    return {
      movies: movies.results.slice(0, 10).map(formatSearchResult),
      shows: shows.results.slice(0, 10).map(formatSearchResult),
    };
  },

  async popular() {
    const [movies, shows] = await Promise.all([
      get('/movie/popular'),
      get('/tv/popular'),
    ]);
    return {
      movies: movies.results.slice(0, 10).map(formatSearchResult),
      shows: shows.results.slice(0, 10).map(formatSearchResult),
    };
  },
};

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || !commands[cmd]) {
    console.error(`Usage: node scripts/tmdb.js <search|movie|tv|trending|popular> [arg]`);
    process.exit(1);
  }

  const result = await commands[cmd](...args);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => { console.error(err.message); process.exit(1); });
