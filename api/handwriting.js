// Proxy for Google Handwriting Recognition API
// Avoids CORS issues and ensures availability from any client location

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ink } = req.body;
    if (!ink || !Array.isArray(ink) || ink.length === 0) {
      return res.status(400).json({ error: 'Missing ink data' });
    }

    const payload = {
      app_version: 0.4,
      api_level: '537.36',
      device: 'AIDUCATION-maanshan',
      input_type: 0,
      options: 'enable_pre_space',
      requests: [{
        writing_guide: { writing_area_width: 560, writing_area_height: 560 },
        ink: ink,
        pre_context: req.body.pre_context || '',
        max_num_results: 10,
        max_completions: 0,
        language: 'zh-hant'
      }]
    };

    const resp = await fetch(
      'https://inputtools.google.com/request?itc=zh-hant-t-i0-handwrit&app=translate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!resp.ok) {
      return res.status(502).json({ error: 'Recognition service error: ' + resp.status });
    }

    const data = await resp.json();
    // data: ["SUCCESS", [["", ["字","宇",...], ...]]]
    if (data[0] === 'SUCCESS' && data[1] && data[1][0] && data[1][0][1]) {
      return res.status(200).json({ candidates: data[1][0][1] });
    }

    return res.status(200).json({ candidates: [] });
  } catch (e) {
    console.error('Handwriting API error:', e.message);
    return res.status(500).json({ error: 'Recognition failed: ' + e.message });
  }
};
