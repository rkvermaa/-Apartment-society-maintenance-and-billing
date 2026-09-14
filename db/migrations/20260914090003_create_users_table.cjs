exports.up = function up(knex) {
  return knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('email').notNullable().unique();
    table.string('password_hash').notNullable();
    table.integer('role_id').unsigned().notNullable()
      .references('id').inTable('roles').onDelete('RESTRICT');
    table.integer('flat_id').unsigned().nullable()
      .references('id').inTable('flats').onDelete('SET NULL');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('users');
};
