class VoiceMemoTranscriber {
  async transcribe(_input) {
    throw Object.assign(new Error('Automatic voice memo transcription is not configured'), {
      code: 'VOICE_MEMO_TRANSCRIBER_UNAVAILABLE',
      statusCode: 501,
    });
  }
}

module.exports = { VoiceMemoTranscriber };
