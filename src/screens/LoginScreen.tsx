export function LoginScreen() {
  return (
    <div>
      <h1>Log in</h1>
      <form>
        <label htmlFor="username">Username</label>
        <input id="username" name="username" type="text" />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" />
        <button type="submit">Log in</button>
      </form>
    </div>
  );
}
