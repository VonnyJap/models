'use strict';
const hoek = require('hoek');
const BaseModel = require('./base');
const JobModel = require('./job');
const schema = require('screwdriver-data-schema');

class PipelineModel extends BaseModel {
    /**
     * Construct a PipelineModel object
     * @method constructor
     * @param  {Object}    datastore         Object that will perform operations on the datastore
     */
    constructor(datastore) {
        super('pipeline', datastore);
    }

    /**
     * Create a pipeline
     * @method create
     * @param  {Object}   config                Config object to create the pipeline with
     * @param  {Object}   config.admins         The admins of this repository
     * @param  {String}   config.scmUrl         The scmUrl for the application
     * @param  {String}   [config.configUrl]    The configUrl for the application
     * @param  {Function} callback              fn(err, data) where data is the newly created object
     */
    create(config, callback) {
        const id = this.generateId(config);
        const createTime = Date.now();
        const data = hoek.applyToDefaults({
            createTime,
            configUrl: config.scmUrl
        }, config);
        const pipelineConfig = {
            table: this.table,
            params: {
                id,
                data
            }
        };

        return this.datastore.save(pipelineConfig, callback);
    }

    /**
     * Sync the pipeline by looking up what is currently in yaml and create or delete
     * jobs if necessary. Right now, this simply creates the job 'main'.
     * @method sync
     * @param  {Object}   config           Config object to create the pipeline with
     * @param  {String}   config.scmUrl    The scmUrl of the repository
     * @param  {Function} callback         Callback function
     */
    // TODO: make this so that it looks up the yaml & create/delete jobs if necessary
    sync(config, callback) {
        const pipelineId = this.generateId(config);

        this.get(pipelineId, (error, data) => {
            if (error) {
                return callback(error);
            }
            if (!data) {
                return callback(null, null);
            }

            const jobModel = new JobModel(this.datastore);
            const jobConfig = {
                pipelineId,
                name: 'main'
            };

            return jobModel.create(jobConfig, callback);
        });
    }

    /**
     * Format the scm url to include a branch and make case insensitive
     * @method formatScmUrl
     * @param  {String}     scmUrl Github scm url
     * @return {String}            Lowercase scm url with branch name
     */
    formatScmUrl(scmUrl) {
        let result = scmUrl;
        const matched = (schema.config.regex.SCM_URL).exec(result);

        // Check if branch name exists
        if (!matched[4]) {
            result = result.concat('#master');
        }

        return result.toLowerCase();
    }
}

module.exports = PipelineModel;