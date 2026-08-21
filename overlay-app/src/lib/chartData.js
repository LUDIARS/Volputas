// チャートの source (inline / api / file) を実データへ解決する
// (spec §グラフ)。取得手段は注入するので node --test から検証できる。
export async function resolveChartData(source, { readJson } = {}) {
  if (!source || source.kind === 'inline') {
    return { ok: true, data: source ? source.data : null };
  }
  if (typeof readJson !== 'function') {
    return {
      ok: false,
      error: { code: 'CHART_SOURCE_UNAVAILABLE', message: 'この環境では外部ソースを読めません' },
    };
  }
  try {
    const data = await readJson({ kind: source.kind, path: source.path });
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error.code || 'CHART_SOURCE_FAILED',
        message: source.kind + ' source の取得に失敗しました: ' + (error.message || error),
      },
    };
  }
}
