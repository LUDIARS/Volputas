const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const WINDOWS_RESERVED_NAME_PATTERN =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function isSafeAnswerOwnerName(value) {
  return Boolean(
    value
    && value !== '.'
    && value !== '..'
    && !/[<>:"/\\|?*\u0000-\u001f]/.test(value)
    && !/[. ]$/.test(value)
    && !WINDOWS_RESERVED_NAME_PATTERN.test(value)
  );
}

function defaultConfigPath() {
  const baseDirectory = process.env.LOCALAPPDATA || path.join(os.homedir(), '.config');
  return path.join(baseDirectory, 'Volputas', 'local-config.json');
}

function validateDataRepositoryPath(value) {
  const dataRepositoryPath = value?.trim();
  if (!dataRepositoryPath || !path.isAbsolute(dataRepositoryPath)) {
    throw Object.assign(new Error('Data repository path must be an absolute path'), {
      code: 'INVALID_DATA_REPOSITORY_PATH',
    });
  }
  return path.resolve(dataRepositoryPath);
}

function validateLocalConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Local configuration must be an object'), {
      code: 'INVALID_LOCAL_CONFIG',
    });
  }

  const dataRepositoryPath = validateDataRepositoryPath(value.dataRepositoryPath);
  const name = (value.name ?? value.githubName)?.trim();

  if (!isSafeAnswerOwnerName(name)) {
    throw Object.assign(new Error('Git Author name cannot be used as an answer folder name'), {
      code: 'INVALID_ANSWER_OWNER_NAME',
    });
  }

  return {
    schemaVersion: 2,
    dataRepositoryPath,
    name,
    researchExportConsent: value.researchExportConsent === true,
  };
}

class LocalConfigStore {
  constructor(configPath = process.env.VOLPUTAS_LOCAL_CONFIG_PATH || defaultConfigPath()) {
    this.configPath = path.resolve(configPath);
  }

  async read() {
    try {
      const text = await fs.readFile(this.configPath, 'utf8');
      return validateLocalConfig(JSON.parse(text));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) {
        throw Object.assign(new Error(`Local configuration is not valid JSON: ${this.configPath}`), {
          code: 'INVALID_LOCAL_CONFIG_FILE',
        });
      }
      throw error;
    }
  }

  async write(value) {
    const config = validateLocalConfig(value);
    const directory = path.dirname(this.configPath);
    const temporaryPath = `${this.configPath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.mkdir(directory, { recursive: true });

    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      await fs.rename(temporaryPath, this.configPath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {
        // The temporary file may not exist if creation itself failed.
      });
      throw error;
    }

    return config;
  }
}

module.exports = {
  LocalConfigStore,
  defaultConfigPath,
  isSafeAnswerOwnerName,
  validateDataRepositoryPath,
  validateLocalConfig,
};
