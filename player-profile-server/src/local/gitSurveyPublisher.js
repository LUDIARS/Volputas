const path = require('node:path');

const FAILURE_MESSAGES = {
  stage: '回答は保存されましたが、Gitのstageに失敗しました',
  inspect: '回答は保存されましたが、Gitの変更確認に失敗しました',
  commit: '回答は保存されましたが、Git commitに失敗しました',
  revision: '回答は保存・commitされましたが、commit情報の取得に失敗しました',
  push: '回答は保存・commitされましたが、GitHubへのpushに失敗しました',
};

function responsePathspec(repositoryRoot, responseFilePath) {
  const root = path.resolve(repositoryRoot);
  const filePath = path.resolve(responseFilePath);
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('Survey response path must be inside the data repository'), {
      code: 'INVALID_RESPONSE_PATH',
    });
  }

  const pathspec = relative.split(path.sep).join('/');
  if (!pathspec.startsWith('answers/') || path.extname(pathspec).toLowerCase() !== '.json') {
    throw Object.assign(new Error('Only survey response JSON files can be published'), {
      code: 'INVALID_RESPONSE_PATH',
    });
  }
  return pathspec;
}

function synchronizationError(phase) {
  const message = FAILURE_MESSAGES[phase] || '回答のGit同期に失敗しました';
  return Object.assign(new Error(`${message}。Git設定、ネットワーク、push権限を確認してください。`), {
    code: 'GIT_SYNC_FAILED',
    statusCode: 502,
    phase,
  });
}

class GitSurveyPublisher {
  constructor(gitCli) {
    this.gitCli = gitCli;
    this.queue = Promise.resolve();
  }

  publish(input) {
    const operation = this.queue.then(() => this.publishNow(input));
    this.queue = operation.catch(() => {
      // Keep the queue usable after a failed synchronization.
    });
    return operation;
  }

  async publishNow({ repositoryRoot, responseFilePath, surveyId }) {
    const root = path.resolve(repositoryRoot);
    const pathspec = responsePathspec(root, responseFilePath);
    await this.run('stage', ['-C', root, 'add', '--', pathspec]);
    const status = await this.run(
      'inspect',
      ['-C', root, 'status', '--porcelain=v1', '--', pathspec]
    );
    const hasChanges = status.stdout.trim().length > 0;

    if (hasChanges) {
      await this.run('commit', [
        '-C',
        root,
        'commit',
        '--only',
        '-m',
        `answers(${surveyId}): save survey response`,
        '--',
        pathspec,
      ]);
    }

    const revision = await this.run('revision', ['-C', root, 'rev-parse', '--short', 'HEAD']);
    await this.run('push', ['-C', root, 'push']);
    return {
      committed: hasChanges,
      pushed: true,
      commit: revision.stdout.trim(),
      pathspec,
    };
  }

  async run(phase, args) {
    try {
      return await this.gitCli.execute(args);
    } catch {
      throw synchronizationError(phase);
    }
  }
}

module.exports = {
  GitSurveyPublisher,
  responsePathspec,
  synchronizationError,
};
