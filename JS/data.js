const products = [];

const categories = [];

// User profile data
let userProfile = JSON.parse(localStorage.getItem('userProfile')) || {
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    pincode: '',
    deliveryInstructions: ''
};

// Footer data
let footerData = JSON.parse(localStorage.getItem('footerData')) || {
    phone: '123-456-7890',
    email: 'contact@supercart.com',
    address: '123 SuperCart Lane, Shopping City, 12345'
};
