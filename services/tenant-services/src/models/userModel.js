const knex = require('../../../shared/src/db/connection'); // Relative path to shared DB connection

const User = {
    async findByEmail(email) {
        return knex('users').where({ email }).first();
    },

    async create(userData) {
        const [user] = await knex('users')
            .insert(userData)
            .returning('*');
        return user;
    },

    async update(id, updates) {
        const [user] = await knex('users')
            .where({ id })
            .update(updates)
            .returning('*');
        return user;
    },

    async findById(id) {
        return knex('users').where({ id }).first();
    },

    async findByInvitationToken(token) {
        return knex('users').where({ invitation_token: token }).first();
    }
};

module.exports = User;
