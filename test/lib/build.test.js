'use strict';
const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');
const hoek = require('hoek');

sinon.assert.expose(assert, { prefix: '' });

/**
 * Stub for Executor K8s factory method
 * @method executorFactoryStub
 */
function executorFactoryStub() {}

describe('Build Model', () => {
    let BuildModel;
    let datastore;
    let executorMock;
    let hashaMock;
    let build;
    let githubMock;
    let breakerMock;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        datastore = {
            get: sinon.stub(),
            save: sinon.stub(),
            scan: sinon.stub()
        };
        hashaMock = {
            sha1: sinon.stub()
        };
        executorMock = {
            start: sinon.stub(),
            stream: sinon.stub()
        };
        githubMock = {
            getBreaker: sinon.stub(),
            getInfo: sinon.stub(),
            run: sinon.stub()
        };
        breakerMock = {
            runCommand: sinon.stub()
        };
        executorFactoryStub.prototype = executorMock;
        mockery.registerMock('screwdriver-hashr', hashaMock);
        mockery.registerMock('./github', githubMock);

        // eslint-disable-next-line global-require
        BuildModel = require('../../lib/build');

        build = new BuildModel(datastore, executorMock);
    });

    afterEach(() => {
        datastore = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('extends base class', () => {
        assert.isFunction(build.get);
        assert.isFunction(build.update);
        assert.isFunction(build.list);
    });

    describe('stream', () => {
        it('calls executor stream with correct values', () => {
            const streamStub = sinon.stub();
            const buildId = 'as12345';

            build.stream({ buildId }, streamStub);
            assert.calledWith(executorMock.stream, {
                buildId
            }, streamStub);
        });
    });

    describe('getBuildsForJobId', () => {
        const config = {
            jobId: 'jobId',
            paginate: {
                page: 1,
                count: 25
            }
        };

        it('returns error when datastore returns error', (done) => {
            const error = new Error('database');

            datastore.scan.yieldsAsync(error);
            build.getBuildsForJobId(config, (err, records) => {
                assert.notOk(records);
                assert.deepEqual(error, err);
                done();
            });
        });

        it('calls datastore with correct values', (done) => {
            datastore.scan.yieldsAsync(null, [{
                jobId: 'jobId',
                number: 1
            }, {
                jobId: 'jobId',
                number: 3
            }, {
                jobId: 'jobId',
                number: 2
            }]);

            build.getBuildsForJobId(config, (err, records) => {
                assert.isNull(err);
                assert.deepEqual(records, [{
                    jobId: 'jobId',
                    number: 1
                }, {
                    jobId: 'jobId',
                    number: 2
                }, {
                    jobId: 'jobId',
                    number: 3
                }]);
                assert.calledWith(datastore.scan, {
                    table: 'builds',
                    params: {
                        jobId: 'jobId'
                    },
                    paginate: {
                        page: 1,
                        count: 25
                    }
                });
                done();
            });
        });
    });

    describe('create', () => {
        const container = 'node:6';
        const jobId = '62089f642bbfd1886623964b4cff12db59869e5d';
        const jobName = 'main';
        const now = 112233445566;
        const pipelineId = 'cf23df2207d99a74fbe169e3eba035e633b65d94';
        const testId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const username = 'myself';
        const sha = 'ccc49349d3cffbd12ea9e3d41521480b4aa5de5f';
        const scmUrl = 'git@github.com:screwdriver-cd/models.git';
        const jobsTableConfig = {
            table: 'jobs',
            params: {
                id: jobId
            }
        };
        const pipelinesTableConfig = {
            table: 'pipelines',
            params: {
                id: pipelineId
            }
        };
        const buildData = {
            cause: 'Started by user',
            container: 'node:4',
            createTime: now,
            jobId,
            number: now,
            status: 'QUEUED',
            sha
        };
        let sandbox;

        beforeEach(() => {
            sandbox = sinon.sandbox.create();

            hashaMock.sha1.returns(testId);
            datastore.save.yieldsAsync(null, {});
            datastore.get.withArgs(jobsTableConfig).yieldsAsync(null, {
                pipelineId,
                name: jobName
            });
            datastore.get.withArgs(pipelinesTableConfig)
                .yieldsAsync(null, { scmUrl });
            executorMock.start.yieldsAsync(null);
            githubMock.run.yieldsAsync(null, null);
            githubMock.getInfo.returns({
                user: username,
                repo: 'models'
            });
            githubMock.getBreaker.returns(breakerMock);
            breakerMock.runCommand.yieldsAsync(null, null);
        });

        it('executes things in order', (done) => {
            build.create({
                username,
                jobId,
                container
            }, () => {
                assert.isOk(datastore.save.calledBefore(executorMock.start));
                done();
            });
        });

        it('creates a new build model and saves it to the datastore', (done) => {
            const saveConfig = {
                table: 'builds',
                params: {
                    id: testId,
                    data: buildData
                }
            };
            const returned = hoek.applyToDefaults({ id: testId }, buildData);

            sandbox.useFakeTimers(now);

            build.create({
                jobId,
                username,
                sha
            }, (err, data) => {
                assert.isNull(err);
                assert.deepEqual(data, returned);
                assert.calledWith(hashaMock.sha1, {
                    jobId,
                    number: now
                });
                assert.calledWith(datastore.save, saveConfig);
                done();
            });

            process.nextTick(sandbox.clock.tick);
        });

        it('creates a build by executing the executor', (done) => {
            build.create({
                jobId,
                container,
                sha
            }, (err) => {
                assert.isNull(err);
                assert.calledWith(executorMock.start, {
                    buildId: testId,
                    container,
                    jobId,
                    jobName,
                    pipelineId,
                    scmUrl
                });
                done();
            });
        });

        it('fails to save the build data to the datastore', (done) => {
            const errorMessage = 'datastoreSaveFailure';

            datastore.save.yieldsAsync(new Error(errorMessage));
            build.create({
                jobId,
                container,
                sha
            }, (err) => {
                assert.strictEqual(err.message, errorMessage);
                done();
            });
        });

        it('fails to lookup the pipeline ID', (done) => {
            const errorMessage = 'LOL';

            datastore.get.withArgs(jobsTableConfig).yieldsAsync(new Error(errorMessage));
            build.create({
                jobId,
                container,
                sha
            }, (err) => {
                assert.strictEqual(err.message, errorMessage);
                done();
            });
        });

        it('fails to lookup scm url', (done) => {
            const errorMessage = 'scmUrlError';

            datastore.get.withArgs(pipelinesTableConfig).yieldsAsync(new Error(errorMessage));
            build.create({
                jobId,
                container,
                sha
            }, (err) => {
                assert.strictEqual(err.message, errorMessage);
                done();
            });
        });

        it('fails to execute the build', (done) => {
            const errorMessage = 'executorStartError';

            executorMock.start.yieldsAsync(new Error(errorMessage));
            build.create({
                jobId,
                container,
                sha
            }, (err) => {
                assert.strictEqual(err.message, errorMessage);
                done();
            });
        });
    });
});