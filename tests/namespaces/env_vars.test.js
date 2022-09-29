'use strict';

const path = require('path');
const fs = require('fs');
const {expect} = require('chai');

const {getTmpDirPath, replaceTextInFile} = require('../utils/fs');
const {getServiceName, sleep, serverlessDeploy, serverlessRemove} = require('../utils/misc');
const {RegistryApi, FunctionApi} = require('../../shared/api');
const {REGISTRY_API_URL, FUNCTIONS_API_URL} = require('../../shared/constants');
const {execSync, execCaptureOutput} = require('../../shared/child-process');

const serverlessExec = path.join('serverless');

// TODO: this test should pass without sleep
describe('Namespaces env vars (normal and secrets) integration test', () => {
  const templateName = path.resolve(__dirname, '..', '..', 'examples', 'secrets');
  const tmpDir = getTmpDirPath();
  let oldCwd;
  let serviceName;
  const scwRegion = process.env.SCW_REGION;
  const scwProject = process.env.SCW_DEFAULT_PROJECT_ID || process.env.SCW_PROJECT;
  const scwToken = process.env.SCW_SECRET_KEY || process.env.SCW_TOKEN;
  const apiUrl = `${FUNCTIONS_API_URL}/${scwRegion}`;
  const registryApiUrl = `${REGISTRY_API_URL}/${scwRegion}/`;

  let api;
  let registryApi;
  let namespace;
  let functionName;

  beforeAll(() => {
    oldCwd = process.cwd();
    serviceName = getServiceName();
    api = new FunctionApi(apiUrl, scwToken);
    registryApi = new RegistryApi(registryApiUrl, scwToken);

    execSync(`${serverlessExec} create --template-path ${templateName} --path ${tmpDir}`);
    process.chdir(tmpDir);
    execSync(`npm link ${oldCwd}`);
    replaceTextInFile('serverless.yml', 'scaleway-secrets', serviceName);
    replaceTextInFile('serverless.yml', '<scw-token>', scwToken);
    replaceTextInFile('serverless.yml', '<scw-project-id>', scwProject);

    // remove secret env vars not essential for that test
    replaceTextInFile('serverless.yml', 'env_secretC: ${ENV_SECRETC}', '');
    replaceTextInFile('serverless.yml', 'env_secret3: ${ENV_SECRET3}', '');

    expect(fs.existsSync(path.join(tmpDir, 'serverless.yml'))).to.be.equal(true);
    expect(fs.existsSync(path.join(tmpDir, 'handler.py'))).to.be.equal(true);
  });

  afterAll(() => {
    process.chdir(oldCwd);
  });

  it('should deploy service to scaleway', async () => {
    serverlessDeploy();
    namespace = await api.getNamespaceFromList(serviceName);
    namespace.functions = await api.listFunctions(namespace.id);
    functionName = namespace.functions[0].name;
  });

  it('should invoke function from scaleway', () => {
    let output = execCaptureOutput(serverlessExec, ['invoke', '--function', functionName]);
    expect(output).to.be.equal('{"env_vars":["env_notSecret1=notSecret1","env_notSecretA=notSecret","env_secret1=value1","env_secret2=other value with special characters ^:;","env_secretA=valueA","env_secretB=value with special characters ^:;"]}');
  });

  it('should update namespace env vars and secrets', () => {
    replaceTextInFile('serverless.yml', 'env_notSecretA: notSecret', 'env_notSecretA: notSecretNew');
    replaceTextInFile('serverless.yml', 'env_secretA: valueA', 'env_secretA: newValueA');
    serverlessDeploy();
  });

  it('should invoke function and get updated env vars from namespace', () => {
    let output = execCaptureOutput(serverlessExec, ['invoke', '--function', functionName]);
    expect(output).to.be.equal('{"env_vars":["env_notSecret1=notSecret1","env_notSecretA=notSecretNew","env_secret1=value1","env_secret2=other value with special characters ^:;","env_secretA=newValueA","env_secretB=value with special characters ^:;"]}');
  });

  it('should update function env vars and secrets', async () => {
    replaceTextInFile('serverless.yml', 'env_notSecret1: notSecret1', 'env_notSecret1: notSecretNew1');
    replaceTextInFile('serverless.yml', 'env_secret1: value1', 'env_secret1: newValue1');
    await sleep(120000); // TODO: if no sleep, why does it fail with Internal error? see "throw new Error(func.error_message)"
    serverlessDeploy();
  });

  it('should invoke function and get updated env vars from function', async () => {
    await sleep(120000); // TODO: if no sleep, function have not been redeployed with the right values, why?
    let output = execCaptureOutput(serverlessExec, ['invoke', '--function', functionName]);
    expect(output).to.be.equal('{"env_vars":["env_notSecret1=notSecretNew1","env_notSecretA=notSecretNew","env_secret1=newValue1","env_secret2=other value with special characters ^:;","env_secretA=newValueA","env_secretB=value with special characters ^:;"]}');
  });

  it('should remove service from scaleway', async () => {
    serverlessRemove();
    try {
      await api.getNamespace(namespace.id);
    } catch (err) {
      expect(err.response.status).to.be.equal(404);
    }
  });

  it('should remove registry namespace properly', async () => {
    const response = await registryApi.deleteRegistryNamespace(namespace.registry_namespace_id);
    expect(response.status).to.be.equal(200);
  });
});
