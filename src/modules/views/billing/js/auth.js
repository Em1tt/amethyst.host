// No bloat allowed! No JQuery allowed! //
const exclamationCircle = `<i class="fa fa-exclamation-circle"></i>`
const loginUser = async (user) => {
    const loginError = document.getElementById('loginerror');
    const url = "/api/auth"
    user.rememberMe = (user.rememberMe == "on")
    try {
        const response = await axios.post(url, user)
        console.log(response)
        location.reload()
    } catch (e) {
        let errorText = "Unknown Error (Look in Console for more details)";
        switch (e.toString()) {
            case "Error: Request failed with status code 403":
                errorText = "Email or Password is incorrect."
                break;
            case "Error: Request failed with status code 404":
                errorText = "User not found.";    
                break;
        }
        loginError.innerHTML = `${exclamationCircle} ${errorText}`;
        console.error(e);
    }
}

const registerUser = async (user) => {
    const regError = document.getElementById('regerror');
    const url = "/api/register"
    try {
        const response = await axios.post(url, user)
        console.log(response)
        location.reload()
    } catch (e) {
        let errorText = "Unknown Error (Look in Console for more details)";
        switch (e.toString()) {
            case "Error: Request failed with status code 406":
                errorText = "Password must not be less than 6 characters."
                break;
            case "Error: Request failed with status code 409":
                errorText = "The email you provided has already been used!";    
                break;
        }
        regError.innerHTML = `${exclamationCircle} Error: ${errorText}`;
        console.error(e);
    }
}

function onLoad() {
    const loginForm = document.querySelector("#loginForm");
    const registerForm = document.querySelector('#registerForm')
    loginForm.addEventListener('submit', event => {
        event.preventDefault();
        const email = loginForm.querySelector('div > #login-email').value;
        const password = loginForm.querySelector('div > #login-password').value;
        const remember = loginForm.querySelector('.checkboxwrap > #rememberMe').value;
        loginUser({
            email,
            password,
            rememberMe: remember
        });
    });
    registerForm.addEventListener('submit', event => {
        event.preventDefault();
        const name = registerForm.querySelector('div > #register-fullname').value;
        const email = registerForm.querySelector('div > #register-email').value;
        const password = registerForm.querySelector('div > #register-password').value;
        const passwordConfirm = registerForm.querySelector('div > #register-confirm-password').value;
        if (password != passwordConfirm) return 403;
        registerUser({
            name,
            email,
            password,
        });
    });
}
