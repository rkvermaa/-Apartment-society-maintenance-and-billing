exports.up = function up(knex) {
  return knex.schema.createTable('sessions', (table) => {
    table.increments('id').primary();
    table.string('token').notNullable().unique();
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.timestamp('expires_at').notNullable();
    table.timestamp('revoked_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('sessions');
};
