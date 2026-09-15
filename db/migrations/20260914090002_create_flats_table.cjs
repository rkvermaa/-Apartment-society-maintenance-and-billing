exports.up = function up(knex) {
  return knex.schema.createTable('flats', (table) => {
    table.increments('id').primary();
    table.string('flat_number').notNullable();
    table.string('block').notNullable();
    table.unique(['flat_number', 'block']);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('flats');
};
