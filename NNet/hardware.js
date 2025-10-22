'use strict';

const os = require('os');

function detectHardware() {
  const cpus = os.cpus() || [];
  const logicalCPUs = cpus.length || 1;

  let tf;
  let backend = 'cpu';
  let gpu = false;
  let tfpkg = null;
  let canUseWasm = false;
  try {
    // Prefer GPU build if available
    tfpkg = '@tensorflow/tfjs-node-gpu';
    tf = require(tfpkg);
    backend = tf.getBackend && tf.getBackend() || 'tensorflow';
    gpu = true;
  } catch (e) {
    try {
      tfpkg = '@tensorflow/tfjs-node';
      tf = require(tfpkg);
      backend = tf.getBackend && tf.getBackend() || 'tensorflow';
    } catch (e2) {
      tfpkg = '@tensorflow/tfjs';
      tf = require(tfpkg);
      backend = tf.getBackend && tf.getBackend() || 'cpu';
      // Try WASM backend for better CPU performance
      try {
        require('@tensorflow/tfjs-backend-wasm');
        canUseWasm = true;
      } catch {}
    }
  }

  return { tf, backend, gpu, logicalCPUs, tfpkg, canUseWasm };
}

module.exports = { detectHardware };
