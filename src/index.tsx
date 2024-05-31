import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { snakeCase } from 'snake-case';

const normalizeFilePath = (path: string) =>
  path.startsWith('file://') ? path.slice(7) : path;

function snakeCaseKeys(obj: { [x: string]: any }): { [x: string]: any } {
  const result: { [x: string]: any } = {};
  Object.keys(obj).forEach((key) => {
    result[snakeCase(key)] = obj[key];
  });
  return result;
}

const LINKING_ERROR =
  `The package 'react-native-s3-multipart' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

const S3Multipart = NativeModules.S3Multipart
  ? NativeModules.S3Multipart
  Platform.OS === "android" ? {} : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

const transferTypes = ['upload', 'download'];
const defaultOptions = {
  remember_last_instance: true,
  region: 'eu-west-1',
};
const defaultCognitoOptions = {
  ...defaultOptions,
  cognito_region: 'eu-west-1',
};
const storeKey = '@_RNS3_Tasks_Extra';
/*
 * taskExtra:
 *	 [id]:
 *		 iOS: { bucket, key, state, bytes, totalBytes }
 *		 Android: { bucket, key, bytes }
 */
let taskExtras: { [x: string]: any } = {};
let listeners: { [x: string]: any } = {}; // [id]: [Function, ...]

const eventEmitter = new NativeEventEmitter(S3Multipart);

eventEmitter.addListener(
  '@_S3Multipart_Events',
  async (event: { task: any; type: any; error: any | undefined }) => {
    if (!taskExtras) await getTaskExtras();
    const { task, error } = event;

    if (task) {
      const { state, bytes, totalBytes } = task;
      let finalTask = await setTaskExtra(
        task,
        { state, bytes, totalBytes },
        false
      );
      if (listeners[task.id]) {
        listeners[task.id].forEach((cb: (arg0: any, arg1: any) => any) =>
          cb(error, finalTask)
        );
      }
    }
  }
);

async function getTaskExtras() {
  try {
    const storeValue = await AsyncStorage.getItem(storeKey);
    taskExtras = storeValue !== null ? JSON.parse(storeValue) : {};
  } catch (e) {
    taskExtras = {};
  }
  return taskExtras;
}

function putExtra(task: { id: string | number }) {
  if (!taskExtras[task.id]) return task;
  return { ...task, ...taskExtras[task.id] };
}

function saveTaskExtras() {
  return AsyncStorage.setItem(storeKey, JSON.stringify(taskExtras));
}

async function setTaskExtra(
  task: { id: any },
  values: {
    state?: any;
    bytes?: any;
    totalBytes?: any;
    bucket?: any;
    key?: any;
    others?: {} | {};
  },
  isNew: boolean | undefined
) {
  const { id } = task;
  if (!taskExtras[id] || isNew) {
    taskExtras[id] = values;
  } else {
    if (taskExtras[id].bytes && !values.bytes) {
      taskExtras[id] = { ...taskExtras[id], state: values.state };
    } else {
      taskExtras[id] = { ...taskExtras[id], ...values };
    }
  }
  await saveTaskExtras();
  return putExtra(task);
}

export async function setupWithNative() {
  const result = await S3Multipart.setupWithNative();
  if (result) {
    await getTaskExtras();
    S3Multipart.initializeRNS3();
  }
  return result;
}

export async function setupWithBasic(options = {}) {
  const opts = snakeCaseKeys(options);
  if (!opts.access_key || !opts.secret_key) {
    return false;
  }
  if (Platform.OS === 'android') {
    opts.session_token = opts.session_token || null;
  }
  const result = await S3Multipart.setupWithBasic({
    ...defaultOptions,
    ...opts,
  });
  if (result) {
    await getTaskExtras();
    S3Multipart.initializeRNS3();
  }
  return result;
}

export async function setupWithCognito(options = {}) {
  const opts = snakeCaseKeys(options);
  if (!opts.identity_pool_id) {
    return false;
  }
  const result = await S3Multipart.setupWithCognito({
    ...defaultCognitoOptions,
    ...opts,
  });
  if (result) {
    await getTaskExtras();
    S3Multipart.initializeRNS3();
  }
  return result;
}

export function enableProgressSent(enabled: any) {
  return S3Multipart.enableProgressSent(enabled);
}

export async function upload(options = {}, others = {}) {
  const opts = snakeCaseKeys(options);
  opts.meta = opts.meta || {};
  const { contentType } = opts.meta;
  if (contentType) {
    opts.meta['Content-Type'] = contentType;
  }
  const task = await S3Multipart.upload({
    ...opts,
    file: normalizeFilePath(opts.file),
  });
  const extra = {
    bucket: opts.bucket,
    key: opts.key,
    others,
    state: null,
  };
  if (Platform.OS === 'ios') {
    extra.state = task.state;
  }
  const finalTask = await setTaskExtra(task, extra, true);
  return finalTask;
}

export async function download(options = {}, others = {}) {
  const opts = snakeCaseKeys(options);
  const task = await S3Multipart.download({
    ...options,
    file: normalizeFilePath(opts.file),
  });
  const extra = {
    bucket: opts.bucket,
    key: opts.key,
    others,
    state: null,
  };
  if (Platform.OS === 'ios') {
    extra.state = task.state;
  }
  const finalTask = await setTaskExtra(task, extra, true);
  return finalTask;
}

export function pause(id: any) {
  S3Multipart.pause(id);
}

export function resume(id: any) {
  S3Multipart.resume(id);
}

export function cancel(id: any) {
  S3Multipart.cancel(id);
}

export function cancelAllUploads() {
  S3Multipart.cancelAllUploads();
}

// Android only
export async function deleteRecord(id: any) {
  if (Platform.OS === 'ios') {
    throw new Error('Not implemented');
  }
  return S3Multipart.deleteRecord(Number(id));
}

export async function getTask(id: any) {
  const task = await S3Multipart.getTask(Number(id));
  if (task) {
    return putExtra(task);
  }
  return null;
}

// idAsKey: return Object with id as key
export async function getTasks(type = '', idAsKey: any) {
  if (transferTypes.indexOf(type) > -1) {
    let tasks = await S3Multipart.getTasks(type);
    tasks = tasks.map((task: any) => putExtra(task));

    if (!idAsKey) return tasks;
    let idAsKeyTasks: { [x: string]: any } = {};
    for (const task of tasks) {
      idAsKeyTasks[task.id] = task;
    }
    return idAsKeyTasks;
  }
  return null;
}

export function subscribe(id: string | number, eventHandler: Function) {
  if (!taskExtras[id]) return;
  if (!listeners[id]) {
    listeners[id] = [];
  }
  const listenersForTask = listeners[id];
  if (listenersForTask.indexOf(eventHandler) < 0) {
    listenersForTask.push(eventHandler);
  }
}

export function unsubscribe(id: string | number, eventHandler: Function) {
  if (!listeners[id]) return;
  if (!eventHandler) {
    delete listeners[id];
    return;
  }
  const listenersForTask = listeners[id];
  const index = listenersForTask.indexOf(eventHandler);
  if (index > 0) {
    listenersForTask.splice(index, 1);
  }
}
