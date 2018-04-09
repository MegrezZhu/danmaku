
function polling () {
    // throw new Error('hey!');
    console.log('polling');
    setTimeout(polling, 1000 * 30);
}

polling();
