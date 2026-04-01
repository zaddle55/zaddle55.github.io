'use strict';

(function() {
  const DEFAULT_CONFIG = {
    executeUrl: 'http://localhost:3001/api/playground/v1/execute',
    editor: 'codemirror',
    provider: 'rust-playground',
    enabledLanguages: [ 'rust' ],
    editorTheme: 'dark',
    policy: {
      timeoutMs: 8000,
      maxCodeBytes: 65536,
      maxOutputBytes: 16384,
      network: 'disabled',
      truncateHeadBytes: 12288,
      truncateTailBytes: 4096
    }
  };

  function mergeConfig(payload) {
    const globalConfig = window.HEXO_PLAYGROUND_CONFIG || {};
    return {
      ...DEFAULT_CONFIG,
      ...globalConfig,
      ...payload,
      policy: {
        ...DEFAULT_CONFIG.policy,
        ...(globalConfig.policy || {}),
        ...((payload && payload.policy) || {})
      }
    };
  }

  function createTextareaDriver(options) {
    const textarea = document.createElement('textarea');
    textarea.className = 'hexo-playground__textarea-fallback';
    textarea.value = options.value;
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', options.language + ' playground editor');
    textarea.style.width = '100%';
    textarea.style.minHeight = '280px';
    textarea.style.padding = '1rem';
    textarea.style.color = '#e5eefc';
    textarea.style.background = 'transparent';
    textarea.style.border = '0';
    textarea.style.resize = 'vertical';
    textarea.style.fontFamily = 'SFMono-Regular, Consolas, monospace';
    textarea.style.lineHeight = '1.6';
    options.mount.replaceChildren(textarea);

    return {
      getValue() {
        return textarea.value;
      },
      setValue(value) {
        textarea.value = value;
      },
      focus() {
        textarea.focus();
      }
    };
  }

  function resolveCodeMirrorTheme(theme) {
    return theme === 'light' ? 'eclipse' : 'material-darker';
  }

  function createCodeMirrorDriver(options) {
    if (!window.CodeMirror) {
      return createTextareaDriver(options);
    }

    const instance = window.CodeMirror(options.mount, {
      value: options.value,
      lineNumbers: true,
      mode: options.language === 'rust' ? 'rust' : null,
      theme: resolveCodeMirrorTheme(options.theme),
      indentUnit: 2,
      tabSize: 2,
      viewportMargin: Infinity
    });

    return {
      getValue() {
        return instance.getValue();
      },
      setValue(value) {
        instance.setValue(value);
      },
      focus() {
        instance.focus();
      }
    };
  }

  function createMonacoDriver(options) {
    return createTextareaDriver(options);
  }

  function createEditorDriver(options) {
    if (options.editor === 'monaco') {
      return createMonacoDriver(options);
    }

    return createCodeMirrorDriver(options);
  }

  function setVisible(element, visible) {
    element.dataset.visible = visible ? 'true' : 'false';
  }

  function setText(element, value) {
    element.textContent = value || '';
  }

  function formatStatus(result) {
    const status = [];

    if (typeof result.elapsedMs === 'number' && result.elapsedMs > 0) {
      status.push(`Elapsed ${result.elapsedMs} ms`);
    }
    if (typeof result.exitCode === 'number') {
      status.push(`Exit ${result.exitCode}`);
    }
    if (result.truncated) {
      status.push('Output truncated');
    }
    if (result.timedOut) {
      status.push('Timed out');
    }

    return status.join(' · ') || 'Done.';
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  function decodePayload(value) {
    const binary = window.atob(value);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function readPayload(root) {
    return decodePayload(root.dataset.playgroundPayload);
  }

  function buildRequest(config, code) {
    return {
      provider: config.provider,
      language: config.language,
      channel: config.channel,
      edition: config.edition,
      mode: config.mode,
      crateType: config.crateType,
      tests: Boolean(config.tests),
      backtrace: Boolean(config.backtrace),
      code,
      policy: config.policy
    };
  }

  async function execute(config, code) {
    const response = await fetch(config.executeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(buildRequest(config, code))
    });

    if (!response.ok) {
      throw new Error(`Execution request failed with status ${response.status}.`);
    }

    return response.json();
  }

  function createInstance(root) {
    const payload = readPayload(root);
    const config = mergeConfig(payload);
    const initialCode = config.code || '';
    const editorMount = root.querySelector('[data-playground-editor]');
    const outputNode = root.querySelector('[data-playground-output]');
    const errorNode = root.querySelector('[data-playground-error]');
    const statusNode = root.querySelector('[data-playground-status]');
    const runButton = root.querySelector('[data-action="run"]');
    const resetButton = root.querySelector('[data-action="reset"]');
    const copyButton = root.querySelector('[data-action="copy"]');
    const editor = createEditorDriver({
      editor: config.editor,
      mount: editorMount,
      value: initialCode,
      language: config.language,
      theme: config.theme
    });

    async function runCode() {
      const source = editor.getValue();
      const codeBytes = new TextEncoder().encode(source).length;

      if (codeBytes > config.policy.maxCodeBytes) {
        setText(statusNode, `Code exceeds ${config.policy.maxCodeBytes} bytes.`);
        setText(errorNode, 'The current playground policy rejected the request before execution.');
        setVisible(errorNode, true);
        setVisible(outputNode, false);
        return;
      }

      root.dataset.busy = 'true';
      runButton.disabled = true;
      setText(statusNode, 'Running...');
      setVisible(outputNode, false);
      setVisible(errorNode, false);

      try {
        const result = await execute(config, source);
        const stdout = result.stdout || '';
        const stderr = result.stderr || '';
        const error = result.error || '';

        setText(outputNode, stdout || '(no stdout)');
        setVisible(outputNode, true);

        if (stderr || error) {
          setText(errorNode, [ stderr, error ].filter(Boolean).join('\n\n'));
          setVisible(errorNode, true);
        } else {
          setText(errorNode, '');
          setVisible(errorNode, false);
        }

        setText(statusNode, formatStatus(result));
      } catch (errorObject) {
        setText(statusNode, 'Run failed.');
        setText(errorNode, errorObject.message || String(errorObject));
        setVisible(errorNode, true);
        setVisible(outputNode, false);
      } finally {
        delete root.dataset.busy;
        runButton.disabled = false;
      }
    }

    runButton.addEventListener('click', () => {
      runCode();
    });

    resetButton.addEventListener('click', () => {
      editor.setValue(initialCode);
      setText(statusNode, 'Reset to initial code.');
      setVisible(outputNode, false);
      setVisible(errorNode, false);
    });

    copyButton.addEventListener('click', async () => {
      try {
        await copyToClipboard(editor.getValue());
        setText(statusNode, 'Copied current code.');
      } catch (errorObject) {
        setText(statusNode, 'Copy failed.');
        setText(errorNode, errorObject.message || String(errorObject));
        setVisible(errorNode, true);
      }
    });

    if (config.run) {
      runCode();
    }
  }

  function boot() {
    document.querySelectorAll('[data-playground-root]').forEach(root => {
      if (root.dataset.ready === 'true') {
        return;
      }
      root.dataset.ready = 'true';
      createInstance(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
