exports.up = function up(knex) {
  return knex.schema.createTable('sessions', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.string('token').notNullable().unique();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('invalidated_at').nullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('sessions');
};
