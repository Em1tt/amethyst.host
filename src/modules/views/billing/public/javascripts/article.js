const footer = document.querySelector("footer");
let id = document.querySelector("#article-id");
id = parseInt(id.innerText.split(" ")[2]);

window.onscroll = function(ev) {
    if ((window.innerHeight + window.scrollY) >= document.body.scrollHeight) {
        footer.style = "bottom: 0px";
    }else{
        footer.style = "bottom: -100px";
    }
};

document.querySelector("#like").addEventListener("click", async () => {
    try{
        const response = await axios.post(`/api/knowledgebase/${id}`, {
            like: 1
        });
        console.log(response);
        location.reload();
    }catch(e){
        console.error(e);
    }
});
document.querySelector("#dislike").addEventListener("click", async () => {
    try{
        const response = await axios.post(`/api/knowledgebase/${id}`, {
            dislike: 1
        });
        console.log(response);
        location.reload();
    }catch(e){
        console.error(e);
    }
});